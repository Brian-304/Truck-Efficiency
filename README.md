# Truck Efficiency

A web app for measuring truck receiving productivity: `index.html` (page), `style.css` (look) and `app.js` (calculations and charts). Plain HTML, CSS and JavaScript, no build step.

## What it does

- **Enter truck:** manifest totals (units, pallets, OMS orders, manifest validation units) and one row per person for each step they worked: unload, break down pallets, validate manifest items (Zebra scan), and downstock totes and pallets.
- **UPH** = manifest units ÷ downstocking labor hours (break down, validate and downstock). Unloading is shown but not counted.
- **Lunches:** a 40 min unpaid lunch comes out for each full-time employee whose truck hours total more than 5. Part-time 15 min breaks are paid and stay in.
- **Double-counting check:** the same first name in two steps at the same time blocks saving.
- **Dashboard:** UPH, units and labor hours, labor by step, a UPH-by-truck line chart against the 90 UPH goal, and a list of trucks.
- **Plan:** checks a schedule against the 90 UPH standard and the team's actual UPH.

## Saving data

The live version runs as a claude.ai artifact and saves trucks in that artifact's shared storage (`window.claude.use("db")`).

Opened anywhere else (for example GitHub Pages or a local file), the calculator, Plan tab and sample preview work, but **saving trucks, the Dashboard of saved trucks and the shared goal do not**. To host it elsewhere with shared data, replace the storage calls with a database such as Firebase or Supabase.
