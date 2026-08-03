/**
 * app.js
 * ---------------------------------------------------------------------------
 * AngularJS 1.8.x module bootstrap:
 *   - module definition + ngRoute config
 *   - app constants (report list, AI config)
 *   - UserService (hardcoded logged-in user for the POC)
 *   - ShellController (nav + chat state)  [controllerAs: "shell"]
 *   - ReportController (embeds the routed report)  [controllerAs: "vm"]
 *   - <ai-chatbot> directive (the floating chat panel)
 *
 * All components use controllerAs syntax, avoid $scope pollution, and carry
 * explicit $inject annotations so the code survives minification.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ngRoute is provided by angular-route.js (CDN). Declare it as a dependency.
  var app = angular.module('biApp', ['ngRoute']);

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  /**
   * EMBED_REPORT — ONE Power BI report that itself contains multiple pages.
   *
   * >>> REPLACE reportId + embedUrl with your real values. <<<
   * embedUrl format (Power BI):
   *   https://app.powerbi.com/reportEmbed?reportId=<REPORT_GUID>&groupId=<WORKSPACE_GUID>
   *
   * There is no report-list navigation anymore — the report's own page tabs are
   * the navigation. Context is captured PER PAGE (see PowerbiService), so each
   * page the user visits/filters gets its own saved entry.
   *
   * While embedUrl still contains "PLACEHOLDER" the app shows a
   * "Configure report" message instead of attempting an embed.
   */
  app.constant('EMBED_REPORT', {
    reportId: 'PLACEHOLDER-REPORT-GUID',
    name: 'My Dashboards',
    embedUrl: 'https://app.powerbi.com/reportEmbed?reportId=PLACEHOLDER-REPORT-GUID'
  });

  /**
   * AI_CONFIG — Anthropic Messages API settings.
   *
   * >>> REPLACE apiKey with a real key for the POC (or better, proxy via backend). <<<
   * For production, leave this blank and route ChatbotService through your server.
   */
  app.constant('AI_CONFIG', {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    apiKey: 'PLACEHOLDER_ANTHROPIC_API_KEY'
  });

  /**
   * USERS — demo login accounts for the POC (config-based, no backend).
   *
   * >>> POC ONLY: never keep plaintext passwords in client config in prod. <<<
   * Replace this with a real auth provider (AAD/MSAL, or a backend /api/login
   * returning a token) later. Each user's userId is what namespaces saved
   * contexts: ctx_<userId>_<reportId>, so the two accounts keep separate state.
   */
  app.constant('USERS', [
    { userId: 'u123', name: 'Demo User One', username: 'demo1', password: 'demo123' },
    { userId: 'u456', name: 'Demo User Two', username: 'demo2', password: 'demo123' }
  ]);

  // ==========================================================================
  // ROUTE CONFIG
  // ==========================================================================
  app.config(configRoutes);
  configRoutes.$inject = ['$routeProvider', '$locationProvider'];
  function configRoutes($routeProvider, $locationProvider) {
    $routeProvider
      // ---- Login page (shown when not authenticated) ----
      .when('/login', {
        template: [
          '<div class="login-wrap">',
          '  <div class="login-card">',
          '    <div class="login-brand">📊 BI Portal</div>',
          '    <h2>Sign in</h2>',
          '    <form ng-submit="login.submit()" novalidate>',
          '      <label>Username</label>',
          '      <input type="text" ng-model="login.username" autocomplete="username" placeholder="demo1" />',
          '      <label>Password</label>',
          '      <input type="password" ng-model="login.password" autocomplete="current-password" placeholder="demo123" />',
          '      <div class="login-error" ng-if="login.error">{{ login.error }}</div>',
          '      <button type="submit" class="btn btn-primary login-btn">Sign in</button>',
          '    </form>',
          '    <div class="login-hint">',
          '      <div><strong>Demo accounts</strong></div>',
          '      <div>demo1 / demo123</div>',
          '      <div>demo2 / demo123</div>',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('\n'),
        controller: 'LoginController',
        controllerAs: 'login'
      })
      // ---- Main portal: embeds the single multi-page report ----
      .when('/', {
        template: '<div class="report-host" style="height:100%;">' +
                    '<div id="reportContainer" class="report-container"></div>' +
                    '<div class="report-message" ng-if="vm.message">{{ vm.message }}</div>' +
                  '</div>',
        controller: 'ReportController',
        controllerAs: 'vm'
      })
      .when('/about-us', {
        template: '<div class="welcome"><h2>About Us</h2><p>Power BI + AI POC Portal empowering executive presentation outlines from deep analytics.</p></div>'
      })
      .when('/gallery', {
        template: '<div class="welcome"><h2>Gallery</h2><p>Analytics Report Gallery showcasing pre-built dashboard templates.</p></div>'
      })
      .otherwise({ redirectTo: '/' });

    // Use hashbang routing so the app runs from a file:// URL with no server.
    $locationProvider.hashPrefix('');
  }

  // ==========================================================================
  // ROUTE GUARD — force unauthenticated users to /login, and bounce
  // already-signed-in users away from /login into the portal.
  // ==========================================================================
  app.run(authGuard);
  authGuard.$inject = ['$rootScope', '$location', 'AuthService'];
  function authGuard($rootScope, $location, AuthService) {
    $rootScope.$on('$routeChangeStart', function (event, next) {
      var path = $location.path();
      var authed = AuthService.isAuthenticated();

      if (!authed && path !== '/login') {
        event.preventDefault();
        $location.path('/login');
      } else if (authed && path === '/login') {
        event.preventDefault();
        $location.path('/');
      }
    });
  }

  // ==========================================================================
  // AUTH SERVICE — validates demo credentials from the USERS constant and
  // tracks the currently signed-in user.
  //
  // The session is persisted in sessionStorage (an AUTH concern, deliberately
  // kept separate from the app-data StorageService so that swapping app data to
  // Redis does not entangle auth). Using sessionStorage keeps the check
  // synchronous, which the route guard needs, and clears when the tab closes.
  // TODO(auth): replace with real identity (AAD/MSAL or backend /api/login).
  // ==========================================================================
  app.factory('AuthService', AuthService);
  AuthService.$inject = ['USERS'];
  function AuthService(USERS) {
    var SESSION_KEY = 'bi_auth_user';

    return {
      login: login,
      logout: logout,
      getCurrentUser: getCurrentUser,
      isAuthenticated: isAuthenticated
    };

    // Validate credentials; on success store a sanitized user (no password).
    function login(username, password) {
      for (var i = 0; i < USERS.length; i++) {
        var u = USERS[i];
        if (u.username === username && u.password === password) {
          var safeUser = { userId: u.userId, name: u.name, username: u.username };
          window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
          return safeUser;
        }
      }
      return null; // invalid credentials
    }

    function logout() {
      window.sessionStorage.removeItem(SESSION_KEY);
    }

    // Returns the signed-in user object, or null if nobody is signed in.
    function getCurrentUser() {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) { return null; }
      try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function isAuthenticated() {
      return !!getCurrentUser();
    }
  }

  // ==========================================================================
  // USER SERVICE — thin facade the rest of the app already depends on.
  // Now backed by AuthService so context keys (ctx_<userId>_...) follow the
  // actually signed-in user. Falls back to an anonymous user defensively.
  // ==========================================================================
  app.factory('UserService', UserService);
  UserService.$inject = ['AuthService'];
  function UserService(AuthService) {
    return {
      getUser: function () {
        return AuthService.getCurrentUser() || { userId: 'anonymous', name: 'Anonymous' };
      }
    };
  }

  // ==========================================================================
  // SHELL CONTROLLER — owns nav list + chat panel open/close state.
  // ==========================================================================
  app.controller('ShellController', ShellController);
  ShellController.$inject = ['$rootScope', '$location', 'AuthService', 'PowerbiService'];
  function ShellController($rootScope, $location, AuthService, PowerbiService) {
    var shell = this;
    shell.chatOpen = false;
    shell.capturing = false;
    shell.currentNav = $location.path() || '/';

    $rootScope.$on('$routeChangeSuccess', function () {
      shell.currentNav = $location.path() || '/';
    });

    shell.onNavChange = function () {
      if (shell.currentNav) {
        $location.path(shell.currentNav);
      }
    };

    // Auth state is read live (getters) so the header/chat appear only when
    // signed in and reflect login/logout without a manual refresh.
    shell.isAuthenticated = AuthService.isAuthenticated;
    shell.currentUser = AuthService.getCurrentUser; // call in template: shell.currentUser()

    // Toggle the chat panel.
    shell.toggleChat = function () {
      shell.chatOpen = !shell.chatOpen;
    };

    // "Send to AI": force-capture the CURRENT page first (so its latest
    // filter/slicer state is saved alongside every previously visited page),
    // then open the chat panel. The panel assembles all saved page contexts
    // into one JSON payload for the AI request.
    shell.sendToAI = function () {
      shell.capturing = true;
      PowerbiService.captureCurrentPage()
        .finally(function () {
          shell.capturing = false;
          shell.chatOpen = true;
        });
    };

    // Sign out: clear session, close chat, return to the login page.
    shell.logout = function () {
      AuthService.logout();
      shell.chatOpen = false;
      $location.path('/login');
    };
  }

  // ==========================================================================
  // LOGIN CONTROLLER — validates the demo credentials and routes into the app.
  // ==========================================================================
  app.controller('LoginController', LoginController);
  LoginController.$inject = ['$location', 'AuthService'];
  function LoginController($location, AuthService) {
    var login = this;
    login.username = '';
    login.password = '';
    login.error = null;

    login.submit = function () {
      login.error = null;
      var user = AuthService.login((login.username || '').trim(), login.password || '');
      if (user) {
        // Success -> go to the portal welcome page.
        $location.path('/');
      } else {
        login.error = 'Invalid username or password.';
      }
    };
  }

  // ==========================================================================
  // REPORT CONTROLLER — embeds the report identified by the :id route param.
  // ==========================================================================
  app.controller('ReportController', ReportController);
  ReportController.$inject = ['$timeout', 'EMBED_REPORT', 'PowerbiService'];
  function ReportController($timeout, EMBED_REPORT, PowerbiService) {
    var vm = this;
    vm.message = '';
    vm.report = EMBED_REPORT;

    // Defer embed until the route template's #reportContainer is in the DOM.
    $timeout(function () {
      var container = document.getElementById('reportContainer');
      if (!container) {
        vm.message = 'Report container not found.';
        return;
      }

      PowerbiService.embedReport(container, vm.report)
        .then(function () {
          vm.message = ''; // embedded fine
        })
        .catch(function (err) {
          // Most commonly NOT_CONFIGURED while the embedUrl is a placeholder.
          if (err && err.code === 'NOT_CONFIGURED') {
            vm.message = 'Configure the report — the embed URL is still a placeholder. ' +
              'Edit EMBED_REPORT in app.js with your real Power BI reportId/embedUrl ' +
              'and wire getEmbedToken() to a valid token.';
          } else {
            vm.message = 'Unable to embed report: ' + (err && err.message ? err.message : 'unknown error');
          }
        });
    }, 0);
  }

  // ==========================================================================
  // <ai-chatbot> DIRECTIVE — the floating chat panel body.
  // Isolated scope; controllerAs "chat"; no $scope pollution.
  // ==========================================================================
  app.directive('aiChatbot', aiChatbot);
  function aiChatbot() {
    return {
      restrict: 'E',
      scope: {
        open: '='   // two-way bound to shell.chatOpen
      },
      controller: ChatPanelController,
      controllerAs: 'chat',
      bindToController: true,
      // Inlined template (not templateUrl) so the app runs directly from a
      // file:// URL, where browsers block XHR fetches of local template files.
      template: [
        '<div class="chat-panel" ng-show="chat.open">',
        '  <div class="chat-header">',
        '    <span>AI Chatbot &mdash; PPT Agent</span>',
        '    <button class="chat-close" ng-click="chat.close()" title="Close">&times;</button>',
        '  </div>',
        '  <div class="chat-body">',
        '    <p class="chat-hint">Ask me to build a PPT outline from all your saved dashboard page contexts.</p>',

        // ---- Collected-context summary (built when the panel opens) ----
        '    <div class="ctx-summary" ng-if="chat.pageCount !== null">',
        '      <div><strong>{{ chat.pageCount }}</strong> saved page context(s) collected into JSON.</div>',
        '      <button class="link-btn" ng-click="chat.showPayload = !chat.showPayload" ng-if="chat.pageCount">',
        '        {{ chat.showPayload ? "Hide" : "View" }} collected JSON</button>',
        '      <pre class="ctx-json" ng-if="chat.showPayload">{{ chat.payloadJson }}</pre>',
        '    </div>',

        // ---- Loading ----
        '    <div class="chat-loading" ng-if="chat.loading">Generating outline&hellip;</div>',

        // ---- Error + retry ----
        '    <div class="chat-error" ng-if="chat.error">',
        '      <div class="chat-error-msg">{{ chat.error }}</div>',
        '      <button class="btn btn-secondary" ng-click="chat.retry()" ng-disabled="!chat.lastRequest">Retry</button>',
        '    </div>',

        // ---- Slide cards ----
        '    <div class="slides" ng-if="chat.slides && chat.slides.length">',
        '      <div class="slides-toolbar">',
        '        <span>{{ chat.slides.length }} slide(s)</span>',
        '        <button class="btn btn-secondary" ng-click="chat.copyJson()">{{ chat.copied ? "Copied!" : "Copy JSON" }}</button>',
        '      </div>',
        '      <div class="slide-card" ng-repeat="slide in chat.slides track by $index">',
        '        <div class="slide-num">Slide {{ $index + 1 }}</div>',
        '        <div class="slide-title">{{ slide.title }}</div>',
        '        <ul class="slide-bullets">',
        '          <li ng-repeat="b in slide.bullets track by $index">{{ b }}</li>',
        '        </ul>',
        '        <div class="slide-visual" ng-if="slide.suggestedVisual"><strong>Suggested visual:</strong> {{ slide.suggestedVisual }}</div>',
        '      </div>',
        '    </div>',
        '  </div>',

        // ---- Input row ----
        '  <div class="chat-input-row">',
        '    <textarea class="chat-input" ng-model="chat.input" rows="2" ',
        '      ng-keydown="$event.keyCode === 13 && !$event.shiftKey && (chat.send() || $event.preventDefault())" ',
        '      placeholder="e.g. Build a PPT summarizing my dashboards"></textarea>',
        '    <button class="btn btn-primary" ng-click="chat.send()" ng-disabled="chat.loading">Send</button>',
        '  </div>',
        '</div>'
      ].join('\n')
    };
  }

  ChatPanelController.$inject = ['$scope', 'ChatbotService'];
  function ChatPanelController($scope, ChatbotService) {
    var chat = this;

    chat.input = 'Build a PPT summarizing my dashboards';
    chat.loading = false;
    chat.error = null;
    chat.slides = null;
    chat.copied = false;
    chat.lastRequest = null;   // remembered so the Retry button can resend
    chat.pageCount = null;     // null = not yet collected
    chat.payloadJson = '';     // pretty-printed collected payload
    chat.showPayload = false;

    // When the panel opens, assemble ALL saved page contexts into one JSON
    // payload and show a summary (this is the JSON that gets sent to the AI).
    $scope.$watch(function () { return chat.open; }, function (isOpen) {
      if (isOpen) { refreshCollectedPayload(); }
    });

    function refreshCollectedPayload() {
      ChatbotService.buildPayload().then(function (payload) {
        chat.pageCount = payload.pageContexts.length;
        chat.payloadJson = JSON.stringify(payload, null, 2);
      });
    }

    // ---- close the panel (open is two-way bound to shell.chatOpen) ----
    chat.close = function () { chat.open = false; };

    // ---- send: call the AI agent and render slide cards ----
    chat.send = function () {
      var request = (chat.input || '').trim();
      if (!request || chat.loading) { return; }
      runRequest(request);
    };

    // ---- retry: resend the last request after an error ----
    chat.retry = function () {
      if (chat.lastRequest) { runRequest(chat.lastRequest); }
    };

    // ---- copyJson: put the raw slide JSON on the clipboard ----
    chat.copyJson = function () {
      if (!chat.slides) { return; }
      var json = JSON.stringify({ slides: chat.slides }, null, 2);
      copyToClipboard(json);
      chat.copied = true;
    };

    function runRequest(request) {
      chat.lastRequest = request;
      chat.loading = true;
      chat.error = null;
      chat.copied = false;

      ChatbotService.generateOutline(request)
        .then(function (outline) {
          chat.slides = outline.slides || [];
        })
        .catch(function (err) {
          chat.slides = null;
          chat.error = (err && err.message) ? err.message : 'Something went wrong.';
        })
        .finally(function () {
          chat.loading = false;
        });
    }

    // Clipboard helper with a legacy fallback for file:// contexts.
    function copyToClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
      } else {
        legacyCopy(text);
      }
    }
    function legacyCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* no-op */ }
      document.body.removeChild(ta);
    }
  }
})();
