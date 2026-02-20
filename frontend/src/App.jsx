import './App.css'
import Sidebar from "./components/sideBar";
import Dashboard from "./pages/Dashboard";

function App() {

  return (
    <>
      <div className="app-layout">

               <Sidebar />


           <div className="main-content">
                <Dashboard />
           </div>

        </div>

      
    </>
  )
}

export default App


