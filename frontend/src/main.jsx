import ReactDOM from 'react-dom/client';
import App from './App';
// import './styles/buttons.css';
import './styles/formValidation.css';
import {BrowserRouter} from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
);
