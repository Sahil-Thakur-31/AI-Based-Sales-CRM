import './App.css'
import Sidebar from "./components/sideBar";
import Settings from './pages/Settings';

const dummyUser = {
    name: "Rahul Sharma",
    role: "admin" // try: "sales-person", "sales-manager"
};


function App() {
  return (

      <div className="app-root">
        <Sidebar />
        <div className="main-container">
          <Settings user={dummyUser} />
        </div>
      </div>
    );
}

export default App

