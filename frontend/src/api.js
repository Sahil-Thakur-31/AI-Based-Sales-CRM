import axios from "axios";

const API = axios.create({
    baseURL : "http://localhost:8080/"
})

API.interceptors.request.use(req =>{
    const token = localStorage.getItem("token");
    if (token) req.headers.Authorization = `Bearer ${token}`;
    return(req);
})

API.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        if (status === 401) {
            localStorage.removeItem("token");
            localStorage.removeItem("RoleName");
            if (window.location.pathname !== "/login") {
                window.location.href = "/login";
            }
        }
        return Promise.reject(error);
    }
);

export default API;
