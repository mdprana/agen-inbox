'use client';
import {useEffect, useState} from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'framer-motion';

const spring={type:'spring',stiffness:500,damping:30};
const Sun=()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
const Moon=()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;

export default function ThemeToggle({className=''}) {
  const [dark,setDark]=useState(false);
  const [mounted,setMounted]=useState(false);
  const reduce=useReducedMotion();
  const transition=reduce?{duration:0}:spring;
  useEffect(()=>{setDark(document.documentElement.classList.contains('dark'));setMounted(true);},[]);
  const toggle=()=>{
    const next=!dark;
    document.documentElement.classList.toggle('dark',next);
    try{localStorage.setItem('theme',next?'dark':'light');}catch{}
    setDark(next);
  };
  return <button type="button" role="switch" aria-checked={dark} aria-label="Mode gelap" className={'themetoggle '+className} onClick={toggle}>
    <span className="themetrack">
      {mounted && <motion.span className="themethumb" initial={false} animate={{x:dark?26:0}} transition={transition}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={dark?'moon':'sun'} className="themeicon" initial={{rotate:-90,scale:0,opacity:0}} animate={{rotate:0,scale:1,opacity:1}} exit={{rotate:90,scale:0,opacity:0}} transition={transition}>{dark?<Moon/>:<Sun/>}</motion.span>
        </AnimatePresence>
      </motion.span>}
    </span>
  </button>;
}
