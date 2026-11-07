import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerPuleWorker } from './pwa/register'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if(import.meta.env.PROD){
 if(document.readyState==='complete')void registerPuleWorker()
 else window.addEventListener('load',()=>void registerPuleWorker(),{once:true})
}
