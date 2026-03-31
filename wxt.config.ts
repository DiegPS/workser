import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Workser',
    description: 'Oculta ofertas de empleo de empresas o palabras clave que no te interesan.',
    permissions: ['storage', 'tabs'],
  },
});
