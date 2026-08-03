# Power BI + AI Portal: Complete Startup & Setup Guide

This document contains everything you need to:
1. **Run the UI and API** in simple steps.
2. **Set up Power BI and Azure App Registration** from scratch to get your `TENANT_ID`, `CLIENT_ID`, and `CLIENT_SECRET`.
3. **Map the Service Principal** in Power BI Admin Portal and Workspace.

---

## Part 1: How to Start the App (UI & API Startup Guide)

This application consists of two parts running together:
- **API (Backend)**: Python FastAPI server running on `http://localhost:8000`. Generates embed tokens via Azure AD & Power BI REST APIs.
- **UI (Frontend)**: Angular 18 website running on `http://localhost:4300`. Provides dashboard embedding, navigation, and AI outline generation.

### One-Time Prerequisites Setup

#### 1. Backend (Python API Setup)
1. Open terminal in the backend directory:
   ```bash
   cd D:\Projects\DEMO\BI\backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create `.env` configuration file:
   ```bash
   copy .env.example .env
   ```

#### 2. Frontend (Angular UI Setup)
1. Open terminal in the root directory:
   ```bash
   cd D:\Projects\DEMO\BI
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

### Everyday Launch Steps (2 Terminals)

#### Terminal 1 — Start the Python API
```bash
cd D:\Projects\DEMO\BI\backend
.venv\Scripts\activate
uvicorn main:app --reload --port 8000
```
- Wait until it prints: `Application startup complete.`
- Verify by visiting: `http://localhost:8000/health` (returns `{"status":"ok"}`).

#### Terminal 2 — Start the Angular UI
```bash
cd D:\Projects\DEMO\BI
npm start
```
- Open browser at `http://localhost:4300`.
- Log in with demo credentials:
  - Username: `user1` | Password: `Demo@123`
  - Username: `user2` | Password: `Demo@123`

---

## Part 2: Azure App Registration & Power BI Setup Guide

Follow these steps to connect your own Power BI reports to the app.

### Step 1: Power BI Account & Workspace Setup
1. Sign in to [Power BI Portal](https://app.powerbi.com) with an organizational (work or school) account.
2. Create a new Workspace (or use an existing custom workspace, e.g., `Analytics Workspace`).
   *Note: Embedding service principal tokens requires a dedicated workspace, not "My Workspace".*
3. Publish your Power BI Report (`.pbix`) into this workspace.

---

### Step 2: Create Azure App Registration (Service Principal)
1. Log in to the [Azure Portal](https://portal.azure.com).
2. In the search bar at the top, search for **App registrations** and select it.
3. Click **+ New registration**.
4. Set the following fields:
   - **Name**: `PowerBI-AI-Embed-App` (or any name you prefer)
   - **Supported account types**: Select **Accounts in this organizational directory only (Single tenant)**.
   - **Redirect URI**: Leave blank.
5. Click **Register**.

---

### Step 3: Retrieve Tenant ID, Client ID, and Client Secret

#### 1. Retrieve Tenant ID & Client ID
- After registration, you will be on the app's **Overview** page.
- Copy **Application (client) ID** $\rightarrow$ This is your `CLIENT_ID`.
- Copy **Directory (tenant) ID** $\rightarrow$ This is your `TENANT_ID`.

#### 2. Generate and Retrieve Client Secret
- In the left sidebar, click **Certificates & secrets**.
- Select the **Client secrets** tab and click **+ New client secret**.
- Enter a description (e.g. `PowerBI API Key`) and select an expiration period (e.g., 6 months or 12 months).
- Click **Add**.
- **CRITICAL**: Copy the value in the **Value** column immediately (NOT the Secret ID!). Save this somewhere safe — Azure will never display it again after you leave the page. $\rightarrow$ This is your `CLIENT_SECRET`.

---

### Step 4: Map Service Principal in Power BI Admin Portal & Workspace

#### 1. Enable Service Principal Embedding in Power BI Admin Portal
1. Open [Power BI Admin Portal - Tenant Settings](https://app.powerbi.com/admin-portal/tenantSettings).
2. Scroll down to **Developer settings** $\rightarrow$ **Embed content in apps**.
3. Toggle the switch to **Enabled**.
4. Under "Apply to", choose **The entire organization** (or specify a security group containing your app).
5. Click **Apply**.

#### 2. Add App to Power BI Workspace
1. Go to your Power BI Workspace on [app.powerbi.com](https://app.powerbi.com).
2. Click **Manage access** in the top right header.
3. Click **+ Add people or groups**.
4. Type your Azure App registration name (e.g. `PowerBI-AI-Embed-App`).
5. Select role as **Member** or **Admin**.
6. Click **Add**.

---

### Step 5: Update `backend/.env` Configuration

Open `D:\Projects\DEMO\BI\backend\.env` and paste your retrieved values:

```env
# Power BI / Azure Service Principal Credentials
TENANT_ID=your-azure-tenant-id-here
CLIENT_ID=your-azure-client-id-here
CLIENT_SECRET=your-azure-client-secret-value-here
```

Restart your Python API terminal (**Ctrl + C** then `uvicorn main:app --reload --port 8000`) for the new `.env` settings to take effect.

---

## Navigation & UI Dropdown Quick Summary

The UI header features a topbar navigation dropdown:
1. **Home**: Primary Power BI embedding & AI prompt workspace (`/dashboard`).
2. **About Us**: Information about the BI + AI POC vision and team (`/about-us`).
3. **Gallery**: Pre-built report templates and analytics showcases (`/gallery`).
4. **Documentation**: Official Power BI reports catalog and developer guide (`/documentation`).

---

## Documented Power BI Reports Catalog

The following pre-configured reports are registered and available in the documentation page (`/documentation`):

| Report Name | Category | Power BI Workspace Report URL |
| ----------- | -------- | ----------------------------- |
| **Human Resource** | Human Resources | `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/07043f0b-ea7f-4dcd-8223-c4b571dcbeac/ReportSection?experience=power-bi` |
| **Sales & Return Sample** | Sales Analytics | `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/c013bf6e-24eb-4793-85ec-424ccaa8d024/ReportSectiond8ab5d035cceb8586528?experience=power-bi` |
| **Store Sales** | Retail & Store Operations | `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/e52d3dc7-ba1b-4333-a9b8-299a0f1ac1e3/5b4ba98b5ad7f12a9ec0?experience=power-bi` |
| **Supplychain** | Logistics & Supply Chain | `https://app.powerbi.com/groups/e22f49f6-bd72-4589-b9cd-b9dd9d942b7c/reports/37eb681d-d48e-4d44-90f4-95abac3618b3/ReportSection?experience=power-bi` |

