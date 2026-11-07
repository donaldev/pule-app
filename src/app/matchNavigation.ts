export interface MatchLocation {route:string;origin:string}
const historyRoutes=new Set(['/matches','/matches/personal','/matches/group'])
export function matchSessionId(route:string) {return /^\/session\/([a-f0-9-]{36})$/i.exec(route)?.[1]??''}
/** Route-only context; never changes the loaded match or submits a scoring action. */
export function nextMatchLocation(previous:MatchLocation,route:string):MatchLocation {
 return {route,origin:matchSessionId(route)&&!matchSessionId(previous.route)?previous.route:previous.origin}
}
export function historyReturnPath(origin:string) {return historyRoutes.has(origin)?origin:'/matches'}
export function activeNavigation(route:string,status?:string,origin='/matches') {
 if(matchSessionId(route))return status==='active'?'/play':status==='finalized'||historyRoutes.has(origin)?'/matches':'/play'
 if(route==='/standings'||route.startsWith('/stats'))return '/stats'
 if(route.startsWith('/matches'))return '/matches'
 if(['/setup','/new-group','/group-settings'].includes(route))return '/play'
 return route
}
