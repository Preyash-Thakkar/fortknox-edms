import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const api = axios.create({
    baseURL: BASE_URL,
    withCredentials: true, // Required for httpOnly cookies (fk_token)
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;