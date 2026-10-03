import "./globals.css";
import localFont from 'next/font/local';
const uiFont = localFont({src:'../public/fonts/source-sans-3-latin.woff2', weight:'200 900', display:'swap', variable:'--font-ui'});
export const metadata = { title: "Agen Inbox", description: "Inbox alias pribadi dan status agen" };
export default function Layout({children}) { return <html lang="id" className={uiFont.variable}><body>{children}</body></html>; }
