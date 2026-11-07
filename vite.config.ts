import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { validatePublicBuild } from './scripts/pwa/config.ts'

export default defineConfig(({command,mode})=>{
 if(command==='build')validatePublicBuild(loadEnv(mode,process.cwd(),'VITE_'),process.env.NETLIFY==='true')
 return {
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ['081c-207-216-31-130.ngrok-free.app'],
  },
  plugins: [react(), tailwindcss(), VitePWA({
   manifest:false, // Existing checked-in manifest is the single source of install metadata.
   injectRegister:false, // Registration has no reload/skipWaiting behavior.
   registerType:'prompt',
   devOptions:{enabled:false},
   workbox:{
    globPatterns:['**/*.{js,css,html,png,svg,webmanifest}'],
    cleanupOutdatedCaches:true,
    skipWaiting:false,
    clientsClaim:false,
    navigateFallback:'/index.html',
    navigateFallbackDenylist:[/^\/(?:auth|rest|realtime|storage|functions)\/v1(?:\/|$)/,/^\/assets\//,/^\/sw\.js$/,/^\/workbox-/],
    ignoreURLParametersMatching:[],
    runtimeCaching:[], // No Supabase/Auth/API caching, offline queues or background sync.
   },
  })],
 }
})
