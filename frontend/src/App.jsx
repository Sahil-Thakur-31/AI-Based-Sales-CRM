import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';

import Login from './pages/Verify/Login';
import ForgotPassword from './pages/Verify/ForgotPassword';
import VerifyOTP from './pages/Verify/VerifyOTP';
import ResetPassword from './pages/Verify/ResetPassword';

import AdminHome from './pages/Admin/AdminHome';
import ManagerHome from './pages/ManagerHome';
import ManageUsers from './pages/Admin/ManageUsers';
import UserForm from './pages/Admin/UserForm';

import Leads from './pages/modules/Leads.jsx';
import Clients from './pages/modules/Clients.jsx';
import Deals from './pages/modules/Deals.jsx';
import Quotations from './pages/modules/Quotations.jsx';
import Meetings from './pages/modules/Meetings.jsx';
import FollowUps from './pages/modules/FollowUps.jsx';
import SalesForecast from './pages/modules/SalesForecast.jsx';
import Expenses from './pages/modules/Expenses.jsx';
import AILeads from './pages/modules/AILeads.jsx';
import Events from './pages/modules/Events.jsx';
import TeamDashboard from './pages/modules/TeamDashboard.jsx';
import Reports from './pages/modules/Reports.jsx';
import Settings from './pages/modules/Settings.jsx';

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
          <Route path="/adminhome" element={<AdminHome />} />
          <Route path="/managerhome" element={<ManagerHome />} />


          {/* CRM Core routes */}
          <Route path="/leads" element={<Leads />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/quotations" element={<Quotations />} />

          <Route path="/meetings" element={<Meetings />} />
          <Route path="/followups" element={<FollowUps />} />

          <Route path="/sales-forecast" element={<SalesForecast />} />
          <Route path="/expenses" element={<Expenses />} />

          <Route path="/ai-leads" element={<AILeads />} />
          <Route path="/events" element={<Events />} />

          <Route path="/team-dashboard" element={<TeamDashboard />} />
          <Route path="/reports" element={<Reports />} />

          <Route path="/settings" element={<Settings />} />


          {/* Admin-only routes */}
          <Route element={<ProtectedRoute allowedRoles={["Admin"]} />}>

            <Route path="/manageusers" element={<ManageUsers />} />
            <Route path="/user-form" element={<UserForm />} />

          </Route>

        </Route>

      </Routes>

    </div>
  );
}

export default App;
