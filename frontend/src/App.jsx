import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';

import Login from './pages/Verify/Login';
import ForgotPassword from './pages/Verify/ForgotPassword';
import VerifyOTP from './pages/Verify/VerifyOTP';
import ResetPassword from './pages/Verify/ResetPassword';

import AdminHome from './pages/AdminHome.jsx';
import ManagerHome from './pages/ManagerHome';
import ManageUsers from './pages/modules/adminsetting/ManageUsers.jsx';

import Leads from './pages/modules/Leads.jsx';
import LeadFormPage from './pages/modules/LeadFormPage.jsx'

import Clients from './pages/modules/Clients.jsx';
import Deals from './pages/modules/Deals.jsx';
import Quotations from './pages/modules/Quotations.jsx';
import NewQuotation from './pages/modules/NewQuotation.jsx';
import QuotationDetails from './pages/modules/QuotationDetails.jsx';
import Meetings from './pages/modules/Meetings.jsx';
import FollowUps from './pages/modules/FollowUps.jsx';
import SalesForecast from './pages/modules/SalesForecast.jsx';
import Expenses from './pages/modules/Expenses.jsx';
import AILeads from './pages/modules/AILeads.jsx';
import Events from './pages/modules/Events.jsx';
import TeamDashboard from './pages/modules/TeamDashboard.jsx';
import Reports from './pages/modules/Reports.jsx';
import Settings from './pages/modules/Settings.jsx';
import Profile from './pages/modules/Profile';

import Products from './pages/modules/adminsetting/Products.jsx';
import Roles from './pages/modules/adminsetting/Roles.jsx';
import Industry from './pages/modules/adminsetting/Industry.jsx';
import Sources from './pages/modules/adminsetting/Sources.jsx';
import Taxes from './pages/modules/adminsetting/Taxes.jsx';

import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";



function App() {
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
          <ProtectedRoute allowedRoles={["Admin", "Manager"]}>
            <Layout />
          </ProtectedRoute>
        }>

          {/* Dashboard routes */}
          <Route path="/adminhome" element={<ProtectedRoute allowedRoles={["Admin"]}>
            <AdminHome />
          </ProtectedRoute>} />
          <Route path="/managerhome" element={<ProtectedRoute allowedRoles={["Manager"]}>
            <ManagerHome />
          </ProtectedRoute>} />


          {/* CRM Core routes */}
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/new" element={<LeadFormPage />} />
          <Route path="/leads/:id" element={<LeadFormPage />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/quotations" element={<Quotations />} />
          <Route path="/quotations/new" element={<NewQuotation />} />
          <Route path="/quotations/:id" element={<QuotationDetails />} />

          <Route path="/meetings" element={<Meetings />} />
          <Route path="/followups" element={<FollowUps />} />

          <Route path="/sales-forecast" element={<SalesForecast />} />
          <Route path="/expenses" element={<Expenses />} />

          <Route path="/ai-leads" element={<AILeads />} />
          <Route path="/events" element={<Events />} />

          <Route path="/team-dashboard" element={<TeamDashboard />} />
          <Route path="/reports" element={<Reports />} />

          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />

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

        </Route>

      </Routes>

    </div>
  );
}

export default App;
