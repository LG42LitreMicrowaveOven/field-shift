/* Single place to configure the backend. For production, set apiBaseUrl to your Render URL
   (e.g. 'https://harvestv-api.onrender.com'). */
const HARVESTV_CONFIG = {
  apiBaseUrl: 'http://127.0.0.1:8000',
  // Development only: serve clearly-labelled demo environmental data instead of calling the backend.
  useMockEnvironment: false
};
