import { Navigate, Route , Routes} from 'react-router-dom';
import './App.css';
import Login from './pages/Login'
import AdminHome from './pages/AdminHome'
import ManagerHome from './pages/ManagerHome'
import ForgotPassword from './pages/ForgotPassword'
import VerifyOTP from './pages/VerifyOTP';
import ResetPassword from './pages/ResetPassword';
import ProtectedRoute from "./components/ProtectedRoute";


function App() {
  return (
    <div className="App">
      <Routes>
        <Route path='/' element={<Navigate to = '/login'/>}/>
        <Route path='/login' element={<Login />} />
        <Route path='/forgot-password' element={<ForgotPassword />} />
        <Route path='/managerhome' element={<ProtectedRoute><ManagerHome /></ProtectedRoute>} />
        <Route path='/adminhome' element={<ProtectedRoute><AdminHome /></ProtectedRoute>} />
        <Route path='/verify-otp' element={<VerifyOTP />} />
        <Route path='/reset-password' element={<ResetPassword />} />
      </Routes>
    </div>
  );
}

export default App;
