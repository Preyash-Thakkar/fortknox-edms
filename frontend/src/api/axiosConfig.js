import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'https://testdevserver1.wehear.in/';

const api = axios.create({
    baseURL: BASE_URL,
    withCredentials: true, // Required for httpOnly cookies (fk_token)
    headers: {
        'Content-Type': 'application/json',
    },
});

export default api;