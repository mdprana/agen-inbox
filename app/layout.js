import "./globals.css";
import localFont from 'next/font/local';
const headFont = localFont({src:'../public/fonts/general-sans-variable.woff2', weight:'200 700', display:'swap', variable:'--font-head'});
const uiFont = localFont({src:'../public/fonts/satoshi-variable.woff2', weight:'300 900', display:'swap', variable:'--font-ui'});
export const metadata = { title: "Agen Inbox", description: "Inbox alias pribadi dan status agen" };
export default function Layout({children}) { return <html lang="id" className={headFont.variable+' '+uiFont.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}"}}/></head><body>{children}</body></html>; }
