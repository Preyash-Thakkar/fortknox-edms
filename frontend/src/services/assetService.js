import api from '../api/axiosConfig';

export const assetService = {
    getStats: async () => {
        const response = await api.get('/stats');
        return response.data;
    },

    getAssets: async (params) => {
        const response = await api.get('/assets', { params });
        return response.data;
    },

    uploadAsset: async (formData) => {
        const response = await api.post('/assets/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    },

    bulkUpload: async (formData) => {
        const response = await api.post('/assets/bulk-upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data;
    },

    updateAsset: async (id, data) => {
        const response = await api.patch(`/assets/${id}`, data);
        return response.data;
    },

    moveAsset: async (id, data) => {
        const response = await api.post(`/assets/${id}/move`, data);
        return response.data;
    },

    deleteAsset: async (id) => {
        const response = await api.delete(`/assets/${id}`);
        return response.data;
    },

    grantAccess: async (id, data) => {
        const response = await api.post(`/assets/${id}/grant`, data);
        return response.data;
    },

    getGrants: async (id) => {
        const response = await api.get(`/assets/${id}/grants`);
        return response.data;
    },

    getVersions: async (id) => {
        const response = await api.get(`/assets/${id}/versions`);
        return response.data;
    },

    viewAsset: async (id) => {
        const response = await api.get(`/assets/${id}/view`);
        return response.data;
    },

    // Used for physically downloading the decrypted file into the browser
    downloadAsset: async (id) => {
        const response = await api.get(`/assets/${id}/raw?download=1`, {
            responseType: 'blob' // CRITICAL: Tells Axios to expect binary data, not JSON
        });
        return response.data;
    }
};