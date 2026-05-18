import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './App.css';

import Login from './pages/Verify/Login';
import ForgotPassword from './pages/Verify/ForgotPassword';
import VerifyOTP from './pages/Verify/VerifyOTP';
import ResetPassword from './pages/Verify/ResetPassword';

import AdminHome from './pages/AdminHome.jsx';
import ManagerHome from './pages/ManagerHome';
import UserHome from './pages/UserHome';
import ManageUsers from './pages/modules/adminsetting/ManageUsers.jsx';

import Leads from './pages/modules/Leads.jsx';
import LeadFormPage from './pages/modules/LeadFormPage.jsx'

import Clients from './pages/modules/Clients.jsx';
import ClientDeals from './pages/modules/ClientDeals.jsx';
import Quotations from './pages/modules/Quotations.jsx';
import NewQuotation from './pages/modules/NewQuotation.jsx';
import QuotationDetails from './pages/modules/QuotationDetails.jsx';
import Notifications from './pages/modules/Notifications.jsx';
// meetings module removed
import FollowUps from './pages/modules/FollowUps.jsx';
import FollowupsAddPage from './pages/modules/FollowupsAddPage.jsx';
import DailyClosingForm from './pages/modules/DailyClosingForm.jsx';
import DailyClosingReport from './pages/modules/DailyClosingReport.jsx';
import SalesForecast from './pages/modules/SalesForecast.jsx';
import Expenses from './pages/modules/Expenses.jsx';
import AILeadGeneration from './pages/modules/AILeadGeneration.jsx';
import AIInsights from './pages/modules/AIInsights.jsx';
import Events from './pages/modules/Events.jsx';
import EventRegistration from './pages/modules/EventRegistration.jsx';
import AddEvent from './pages/modules/AddEvent.jsx';
import TeamDashboard from './pages/modules/TeamDashboard.jsx';
import TeamSetup from './pages/modules/TeamSetup.jsx';
import TeamTargets from './pages/modules/TeamTargets.jsx';
import TeamTargetsAdmin from './pages/modules/TeamTargetsAdmin.jsx';
import TeamTargetsManager from './pages/modules/TeamTargetsManager.jsx';
import Reports from './components/Reports/Reports.jsx';
import Settings from './pages/modules/Settings.jsx';
import Profile from './pages/modules/Profile';
import CalendarPage from './pages/modules/CalendarPage.jsx';

import Products from './pages/modules/adminsetting/Products.jsx';
import Roles from './pages/modules/adminsetting/Roles.jsx';
import Industry from './pages/modules/adminsetting/Industry.jsx';
import Sources from './pages/modules/adminsetting/Sources.jsx';
import Taxes from './pages/modules/adminsetting/Taxes.jsx';
import Organization from './pages/modules/adminsetting/Organization.jsx';
import QuotationClauses from './pages/modules/adminsetting/QuotationClauses.jsx';

import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import API from "./api";
import {
  buildDocumentTitle,
  getCachedOrganizationBrand,
  normalizeOrganizationBrand,
  notifyOrganizationBrandUpdated,
  ORGANIZATION_BRAND_UPDATED_EVENT,
  setDocumentFavicon
} from "./utils/branding";
import { getPageTitle } from "./utils/pageMeta";



function App() {
  const location = useLocation();
  const authToken = localStorage.getItem("token") || "";
  const [organizationBrand, setOrganizationBrand] = useState(() => getCachedOrganizationBrand());
  const pageTitle = useMemo(
    () => getPageTitle(location.pathname, location.search),
    [location.pathname, location.search]
  );

  useEffect(() => {
    const handleBrandUpdate = (event) => {
      setOrganizationBrand(normalizeOrganizationBrand(event.detail));
    };

    const handleStorage = (event) => {
      if (event.key === "organizationBranding") {
        setOrganizationBrand(getCachedOrganizationBrand());
      }
    };

    window.addEventListener(ORGANIZATION_BRAND_UPDATED_EVENT, handleBrandUpdate);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(ORGANIZATION_BRAND_UPDATED_EVENT, handleBrandUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!authToken) return;

    let active = true;

    const loadOrganizationBrand = async () => {
      try {
        const res = await API.get("/organizations/profile");
        if (!active) return;
        const nextBrand = notifyOrganizationBrandUpdated(res.data?.organization || null);
        setOrganizationBrand(nextBrand);
      } catch (err) {
        if (!active) return;
        console.error("Failed to load organization brand:", err);
      }
    };

    loadOrganizationBrand();

    return () => {
      active = false;
    };
  }, [authToken]);

  useEffect(() => {
    document.title = buildDocumentTitle(pageTitle, organizationBrand.shortName || organizationBrand.companyName);
    setDocumentFavicon(organizationBrand.iconUrl || organizationBrand.logoUrl);
  }, [
    pageTitle,
    organizationBrand.companyName,
    organizationBrand.shortName,
    organizationBrand.logoUrl,
    organizationBrand.iconUrl
  ]);

  return (
    <div className="App">

      <Routes>

        {/* Public routes */}
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
        <Route path="/reset-password" element={<ResetPassword />} />


        {/* Protected routes with Layout */}
        <Route element={
          <ProtectedRoute allowedRoles={["Admin", "Manager", "User", null]}>
              <Layout organizationLogoUrl={organizationBrand.logoUrl} organizationIconUrl={organizationBrand.iconUrl} />
          </ProtectedRoute>
        }>

          {/* Dashboard routes */}
          <Route path="/adminhome" element={<ProtectedRoute allowedRoles={["Admin"]}>
            <AdminHome />
          </ProtectedRoute>} />
          <Route path="/managerhome" element={<ProtectedRoute allowedRoles={["Manager", "Admin"]}>
            <ManagerHome />
          </ProtectedRoute>} />
          <Route path="/userhome" element={<ProtectedRoute allowedRoles={["User", "Manager", "Admin", null]}>
            <UserHome />
          </ProtectedRoute>} />


          {/* CRM Core routes */}
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/new" element={<LeadFormPage />} />
          <Route path="/leads/:id" element={<LeadFormPage />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/new" element={<LeadFormPage formMode="client" />} />
          <Route path="/clients/:id" element={<LeadFormPage formMode="client" />} />
          <Route path="/clients/:id/deals" element={<ClientDeals />} />
          <Route path="/deals" element={<Leads defaultView="deals" />} />
          <Route path="/quotations" element={<Quotations />} />
          <Route path="/quotations/new" element={<NewQuotation />} />
          <Route path="/quotations/:id" element={<QuotationDetails />} />
          <Route path="/notifications" element={<Notifications />} />

          <Route path="/followups" element={<FollowUps />} />
          <Route path="/followups/add" element={<FollowupsAddPage />} />
          <Route
            path="/daily-closing"
            element={
              <ProtectedRoute allowedRoles={["User", "Manager"]}>
                <Navigate to="/daily-closing/form" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-closing/form"
            element={
              <ProtectedRoute allowedRoles={["User", "Manager"]}>
                <DailyClosingForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-closing/report"
            element={
              <ProtectedRoute allowedRoles={["User", "Manager"]}>
                <DailyClosingReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/sales-forecast"
            element={
              <ProtectedRoute allowedRoles={["Manager", "Admin"]}>
                <SalesForecast />
              </ProtectedRoute>
            }
          />
          <Route path="/expenses" element={<Expenses />} />

          <Route
            path="/ai-leads"
            element={
              <ProtectedRoute allowedRoles={["Manager", "Admin"]}>
                <AILeadGeneration />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai-insights"
            element={
              <ProtectedRoute allowedRoles={["User", "Manager", "Admin"]}>
                <AIInsights />
              </ProtectedRoute>
            }
          />
          <Route path="/events" element={<Events />} />
          <Route path="/events/new" element={<AddEvent />} />
          <Route path="/events/register" element={<EventRegistration />} />

          <Route path="/team-dashboard" element={<ProtectedRoute allowedRoles={["Manager", "Admin"]}><TeamDashboard /></ProtectedRoute>} />
          <Route path="/team-setup" element={<ProtectedRoute allowedRoles={["Admin"]}><TeamSetup /></ProtectedRoute>} />
          <Route path="/team-targets" element={<ProtectedRoute allowedRoles={["Manager", "Admin"]}><TeamTargets /></ProtectedRoute>} />
          <Route path="/team-targets/admin" element={<ProtectedRoute allowedRoles={["Admin"]}><TeamTargetsAdmin /></ProtectedRoute>} />
          <Route path="/team-targets/manage" element={<ProtectedRoute allowedRoles={["Manager"]}><TeamTargetsManager /></ProtectedRoute>} />
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={["User", "Manager", "Admin"]}>
                <Reports />
              </ProtectedRoute>
            }
          />

          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/calendar" element={<CalendarPage />} />

          {/* Admin-only routes */}
          <Route
            path="/manageusers"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <ManageUsers />
              </ProtectedRoute>
            }
          />

          <Route
            path="/products"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Products />
              </ProtectedRoute>
            }
          />

          <Route
            path="/roles"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Roles />
              </ProtectedRoute>
            }
          />

          <Route
            path="/industry"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Industry />
              </ProtectedRoute>
            }
          />

          <Route
            path="/sources"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Sources />
              </ProtectedRoute>
            }
          />

          <Route
            path="/taxes"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Taxes />
              </ProtectedRoute>
            }
          />

          <Route
            path="/organization"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <Organization />
              </ProtectedRoute>
            }
          />

          <Route
            path="/quotation-clauses"
            element={
              <ProtectedRoute allowedRoles={["Admin"]}>
                <QuotationClauses />
              </ProtectedRoute>
            }
          />

        </Route>

      </Routes>

    </div>
  );
}

export default App;
