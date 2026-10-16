import './style.css';
export const metadata={title:'GoalPulse PRO',description:'Torschützenanalyse für heutige Fußball- und Eishockeyspiele',appleWebApp:{capable:true,title:'GoalPulse',statusBarStyle:'default'}};
export default function Layout({children}){return <html lang="de"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><body>{children}</body></html>}
