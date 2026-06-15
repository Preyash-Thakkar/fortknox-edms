import { useState, useEffect, useCallback } from 'react';
import { api } from './auth';

// Loads the category + department tree once and exposes a refresh function.
// Used by the sidebar, the repository filter, the upload form, and settings.
export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/categories');
      setCategories(data.categories);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { categories, loading, refresh };
}
