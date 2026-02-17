import './App.css'
import Sidebar from "./Sidebar";

function App() {
  return (
      <div style={{ display: "flex" }}>
        <Sidebar />
        <div>Main Content</div>
      </div>
    );
}

export default App
