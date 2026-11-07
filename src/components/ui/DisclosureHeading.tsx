import type { ReactNode } from 'react'
export function DisclosureHeading({children,expanded,controls,onToggle}:{children:ReactNode;expanded:boolean;controls:string;onToggle:()=>void}) {
 return <header className="disclosure-heading"><h2><button type="button" className="disclosure-toggle" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}><span>{children}</span><svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={expanded?'m6 15 6-6 6 6':'m6 9 6 6 6-6'}/></svg></button></h2></header>
}
