import './App.css'
import Sidebar from "./sideBar";

function App() {
  return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <div>Main Content</div>
      </div>
    );
}

export default App
