/**
 * powerbiService.js
 * ---------------------------------------------------------------------------
 * Encapsulates ALL Power BI embedding concerns for a SINGLE embedded report
 * that contains MULTIPLE pages (the report's own page tabs are the navigation):
 *   - embedding the report into a DOM container (with reset() to kill stale iframes)
 *   - capturing context PER PAGE (page, filters, slicers) whenever the user
 *     changes a filter/slicer or switches pages
 *   - restoring a page's context when the user navigates back to it
 *   - a mock embed-token function to be wired to a real backend later
 *   - captureCurrentPage(): force an immediate capture of the active page,
 *     used by the "Send to AI" button before collecting all page contexts
 *
 * Depends on the global `powerbi-client` library (window.powerbi + window['powerbi-client']).
 *
 * Per-PAGE storage key:  ctx_<userId>_<reportId>_<pageName>
 * Context payload shape:
 *   {
 *     reportId, reportName, pageName, pageDisplayName,
 *     reportFilters: [...], pageFilters: [...],
 *     slicers: [ { visualName, state }, ... ],
 *     savedAt: ISO string
 *   }
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  angular
    .module('biApp')
    .factory('PowerbiService', PowerbiService);

  PowerbiService.$inject = ['$q', '$timeout', 'StorageService', 'UserService'];

  function PowerbiService($q, $timeout, StorageService, UserService) {
    // Grab the models enum + service instance from the global powerbi-client lib.
    var pbiClient = window['powerbi-client'];
    var models = pbiClient ? pbiClient.models : null;
    // window.powerbi is the pre-constructed service singleton from the CDN build.
    var powerbiSvc = window.powerbi;

    // References to the currently embedded report so captureCurrentPage() works.
    var _currentReport = null;        // the embedded report instance
    var _currentDescriptor = null;    // the EMBED_REPORT descriptor { reportId, name, embedUrl }

    var _captureDebounce = null;      // collapses rapid "rendered" events
    var _restoring = false;           // suppresses capture while we re-apply state

    var service = {
      isConfigured: isConfigured,
      getEmbedToken: getEmbedToken,
      embedReport: embedReport,
      resetContainer: resetContainer,
      captureCurrentPage: captureCurrentPage
    };
    return service;

    // -----------------------------------------------------------------------
    // isConfigured: guard so the app runs before a real embed URL/token exists.
    // -----------------------------------------------------------------------
    function isConfigured(report) {
      if (!report || !report.embedUrl) { return false; }
      return report.embedUrl.indexOf('PLACEHOLDER') === -1 && !!powerbiSvc && !!models;
    }

    // -----------------------------------------------------------------------
    // getEmbedToken: MOCK token provider.
    // TODO(backend): replace with a real call, e.g.
    //   return $http.post('/api/getEmbedToken', { reportId: reportId })
    //            .then(function (res) { return res.data.token; });
    // -----------------------------------------------------------------------
    function getEmbedToken(reportId) {
      return $q(function (resolve) {
        resolve('MOCK_EMBED_TOKEN_FOR_' + reportId);
      });
    }

    // -----------------------------------------------------------------------
    // resetContainer: destroy any existing embed so we never stack stale iframes.
    // -----------------------------------------------------------------------
    function resetContainer(containerEl) {
      if (powerbiSvc && containerEl) {
        powerbiSvc.reset(containerEl);
      }
    }

    // -----------------------------------------------------------------------
    // embedReport: embed the single multi-page report.
    // Returns a promise resolving to the embedded report (or rejecting with
    // NOT_CONFIGURED so the controller can show the "Configure report" message).
    // -----------------------------------------------------------------------
    function embedReport(containerEl, report) {
      return $q(function (resolve, reject) {
        // Always reset first to avoid stale iframes, and clear old references.
        resetContainer(containerEl);
        _currentReport = null;
        _currentDescriptor = null;

        if (!isConfigured(report)) {
          reject({ code: 'NOT_CONFIGURED', message: 'Embed URL is a placeholder — configure a real reportId/embedUrl/token.' });
          return;
        }

        getEmbedToken(report.reportId).then(function (token) {
          var config = {
            type: 'report',
            id: report.reportId,
            embedUrl: report.embedUrl,
            accessToken: token,
            tokenType: models.TokenType.Embed,
            settings: {
              panes: { filters: { visible: true }, pageNavigation: { visible: true } }
            }
          };

          var embeddedReport;
          try {
            embeddedReport = powerbiSvc.embed(containerEl, config);
          } catch (embedErr) {
            reject({ code: 'EMBED_FAILED', message: String(embedErr) });
            return;
          }

          _currentReport = embeddedReport;
          _currentDescriptor = report;

          // ----- LOADED: restore the last active page's saved context -----
          embeddedReport.off('loaded');
          embeddedReport.on('loaded', function () {
            restoreActivePage(embeddedReport, report).catch(function (err) {
              console.warn('[PowerbiService] restore on load failed:', err);
            });
          });

          // ----- RENDERED: capture the active page's context, debounced 800ms.
          // Fires on filter changes, slicer changes, and page switches. -----
          embeddedReport.off('rendered');
          embeddedReport.on('rendered', function () {
            if (_restoring) { return; } // don't capture the state we just restored
            if (_captureDebounce) { $timeout.cancel(_captureDebounce); }
            _captureDebounce = $timeout(function () {
              captureContext(embeddedReport, report).catch(function (err) {
                console.warn('[PowerbiService] capture failed:', err);
              });
            }, 800);
          });

          // ----- PAGE CHANGED: restore that page's saved context (if any) -----
          embeddedReport.off('pageChanged');
          embeddedReport.on('pageChanged', function (evt) {
            var newPageName = evt && evt.detail && evt.detail.newPage ? evt.detail.newPage.name : null;
            if (!newPageName) { return; }
            restorePageContext(embeddedReport, report, newPageName).catch(function (err) {
              console.warn('[PowerbiService] restore on pageChanged failed:', err);
            });
          });

          embeddedReport.off('error');
          embeddedReport.on('error', function (evt) {
            console.error('[PowerbiService] Power BI error:', evt.detail);
          });

          resolve(embeddedReport);
        });
      });
    }

    // -----------------------------------------------------------------------
    // captureCurrentPage: public — capture the active page RIGHT NOW.
    // Used by "Send to AI" so the current page's latest state is saved before
    // all page contexts are collected. No-ops safely if nothing is embedded.
    // -----------------------------------------------------------------------
    function captureCurrentPage() {
      if (!_currentReport || !_currentDescriptor) { return $q.resolve(); }
      return captureContext(_currentReport, _currentDescriptor)
        .catch(function (err) {
          console.warn('[PowerbiService] captureCurrentPage failed:', err);
        });
    }

    // -----------------------------------------------------------------------
    // captureContext: snapshot the ACTIVE page and persist it page-wise.
    // -----------------------------------------------------------------------
    function captureContext(embeddedReport, report) {
      var user = UserService.getUser();

      return embeddedReport.getPages().then(function (pages) {
        var activePage = getActivePage(pages);
        if (!activePage) { return; }

        var reportFiltersP = embeddedReport.getFilters().catch(function () { return []; });
        var pageFiltersP = activePage.getFilters().catch(function () { return []; });
        var slicersP = captureSlicers(activePage);

        return $q.all({
          reportFilters: reportFiltersP,
          pageFilters: pageFiltersP,
          slicers: slicersP
        }).then(function (results) {
          var context = {
            reportId: report.reportId,
            reportName: report.name,
            pageName: activePage.name,
            pageDisplayName: activePage.displayName,
            reportFilters: results.reportFilters,
            pageFilters: results.pageFilters,
            slicers: results.slicers,
            savedAt: new Date().toISOString()
          };
          var key = buildKey(user.userId, report.reportId, activePage.name);
          return StorageService.setItem(key, context);
        });
      });
    }

    // Capture slicer states for every visual of type "slicer" on the page.
    function captureSlicers(page) {
      return page.getVisuals().then(function (visuals) {
        var slicerVisuals = visuals.filter(function (v) { return v.type === 'slicer'; });
        var statePromises = slicerVisuals.map(function (v) {
          return v.getSlicerState()
            .then(function (state) { return { visualName: v.name, state: state }; })
            .catch(function () { return { visualName: v.name, state: null }; });
        });
        return $q.all(statePromises);
      });
    }

    // -----------------------------------------------------------------------
    // restoreActivePage: on load, re-apply the saved context of whatever page
    // is currently active (defaults if none saved).
    // -----------------------------------------------------------------------
    function restoreActivePage(embeddedReport, report) {
      return embeddedReport.getPages().then(function (pages) {
        var activePage = getActivePage(pages);
        if (!activePage) { return; }
        return restorePageContext(embeddedReport, report, activePage.name);
      });
    }

    // -----------------------------------------------------------------------
    // restorePageContext: read the saved context for a specific page and
    // re-apply report filters + page filters + slicer states. Guarded by
    // _restoring so the resulting "rendered" events don't re-capture.
    // -----------------------------------------------------------------------
    function restorePageContext(embeddedReport, report, pageName) {
      var user = UserService.getUser();
      var key = buildKey(user.userId, report.reportId, pageName);

      return StorageService.getItem(key).then(function (context) {
        if (!context) { return; } // nothing saved for this page -> defaults

        _restoring = true;
        var chain = $q.resolve();

        // 1) Report-level filters (Replace).
        if (context.reportFilters && context.reportFilters.length) {
          chain = chain.then(function () {
            return embeddedReport.updateFilters(models.FiltersOperations.Replace, context.reportFilters)
              .catch(function (e) { console.warn('[PowerbiService] updateFilters failed:', e); });
          });
        }

        // 2) Page-level filters + slicers on the matching page.
        chain = chain.then(function () {
          return embeddedReport.getPages().then(function (pages) {
            var target = null;
            for (var i = 0; i < pages.length; i++) {
              if (pages[i].name === pageName) { target = pages[i]; break; }
            }
            if (!target) { return; }

            var inner = $q.resolve();

            if (context.pageFilters && context.pageFilters.length) {
              inner = inner.then(function () {
                return target.updateFilters(models.FiltersOperations.Replace, context.pageFilters)
                  .catch(function (e) { console.warn('[PowerbiService] page updateFilters failed:', e); });
              });
            }

            if (context.slicers && context.slicers.length) {
              inner = inner.then(function () {
                return target.getVisuals().then(function (visuals) {
                  var byName = {};
                  visuals.forEach(function (v) { byName[v.name] = v; });
                  var applies = context.slicers.map(function (s) {
                    var visual = byName[s.visualName];
                    if (visual && s.state) {
                      return visual.setSlicerState(s.state).catch(function (e) {
                        console.warn('[PowerbiService] setSlicerState failed for', s.visualName, e);
                      });
                    }
                    return $q.resolve();
                  });
                  return $q.all(applies);
                });
              });
            }
            return inner;
          });
        });

        return chain.finally(function () {
          // Release the guard shortly after so the settle-render isn't captured.
          $timeout(function () { _restoring = false; }, 900);
        });
      });
    }

    // ----------------------------- helpers ---------------------------------

    function getActivePage(pages) {
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].isActive) { return pages[i]; }
      }
      return pages.length ? pages[0] : null;
    }

    function buildKey(userId, reportId, pageName) {
      return 'ctx_' + userId + '_' + reportId + '_' + pageName;
    }
  }
})();
