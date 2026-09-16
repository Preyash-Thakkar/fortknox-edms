import api from '../api/axiosConfig';

export const requestService = {
    createRequest: async (data) => {
        const response = await api.post('/access-requests', data);
        return response.data;
    },

    getRequests: async () => {
        const response = await api.get('/access-requests');
        return response.data;
    },

    decideRequest: async (id, decision) => {
        const response = await api.post(`/access-requests/${id}/decide`, { decision });
        return response.data;
    },

    getNotifications: async () => {
        const response = await api.get('/notifications');
        return response.data;
    },

    markNotificationsRead: async () => {
        const response = await api.post('/notifications/read');
        return response.data;
    }
};