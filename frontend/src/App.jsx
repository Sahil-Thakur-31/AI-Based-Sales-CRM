import { Navigate, Route , Routes} from 'react-router-dom';
import './App.css';
import Login from './pages/Verify/Login'
import AdminHome from './pages/Admin/AdminHome'
import ManagerHome from './pages/ManagerHome'
import ForgotPassword from './pages/Verify/ForgotPassword'
import VerifyOTP from './pages/Verify/VerifyOTP';
import ResetPassword from './pages/Verify/ResetPassword';
import ProtectedRoute from "./components/ProtectedRoute";
import ManageUsers from './pages/Admin/ManageUsers';
import UserForm from './pages/Admin/UserForm'

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path='/' element={<Navigate to = '/login'/>}/>
        <Route path='/login' element={<Login />} />
        <Route path='/forgot-password' element={<ForgotPassword />} />
        <Route path='/verify-otp' element={<VerifyOTP />} />
        <Route path='/reset-password' element={<ResetPassword />} />
        <Route path='/managerhome' element={<ProtectedRoute allowedRoles={["Manager"]}><ManagerHome /></ProtectedRoute>} />
        <Route path='/adminhome' element={<ProtectedRoute allowedRoles={["Admin"]}><AdminHome /></ProtectedRoute>} />
        <Route path='/manageusers' element={<ProtectedRoute allowedRoles={["Admin"]}><ManageUsers /></ProtectedRoute>} />
        <Route path='/user-form' element={<ProtectedRoute allowedRoles={["Admin"]}><UserForm /></ProtectedRoute>} />
      </Routes>
    </div>
  );
}

export default App;
