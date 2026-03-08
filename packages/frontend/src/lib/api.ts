import createClient from 'openapi-fetch';
import type { paths } from '../generated/api-types';

// In dev, Vite proxies /api/* to http://localhost:3100/* (strips /api prefix)
// In production, /api/* hits the same origin (Traefik routes)
const API_BASE_URL = '/api';

export const apiClient = createClient<paths>({ baseUrl: API_BASE_URL });
