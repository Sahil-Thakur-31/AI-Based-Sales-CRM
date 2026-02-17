import './App.css'
import Sidebar from "./components/sideBar";
import Profile from './pages/profile';
import Settings from './pages/Settings';

function App() {
  return (
        <div className="app-root">
          <Sidebar />
          <div className="main-container">
            <Profile/>
          </div>
        </div>
    );
}

export default App

