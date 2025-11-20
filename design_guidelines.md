# Deecell Fleet Tracking Dashboard - Design Guidelines

## Design Approach
**System-Based Design** using principles from Material Design and Carbon Design System - optimized for data-heavy enterprise applications with emphasis on clarity, scanability, and efficient information display.

**Core Principle**: Clean, minimalistic interface with white background prioritizing data legibility and operational efficiency.

---

## Typography

**Font Family**: Inter (via Google Fonts CDN)
- Primary interface font with excellent readability at small sizes
- Clear numerical distinction crucial for data tables

**Hierarchy**:
- Dashboard Title: text-2xl font-semibold (24px)
- Section Headers: text-lg font-semibold (18px)
- Table Headers: text-sm font-medium uppercase tracking-wide (14px)
- Data Values: text-sm font-normal (14px)
- Metadata/Labels: text-xs text-gray-500 (12px)

---

## Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8
- Component padding: p-4, p-6
- Section spacing: space-y-6, space-y-8
- Table cell padding: px-4 py-3
- Card padding: p-6

**Container Structure**:
- Full viewport application (no max-width constraint)
- Sidebar navigation: w-64 fixed
- Main content: ml-64 with p-8 padding
- Grid layouts for cards: grid-cols-1 lg:grid-cols-2 xl:grid-cols-4

---

## Component Library

### Navigation Sidebar
- Fixed left sidebar (w-64, bg-white, border-r border-gray-200)
- Deecell logo at top (h-16 with p-4)
- Navigation items: px-4 py-2 with rounded-md hover states
- Active state: bg-gray-100 with border-l-4 accent indicator

### Fleet Dashboard Header
- Metrics cards in 4-column grid showing fleet summary:
  - Total Trucks, Active Trucks, Avg SoC, Total Runtime
  - White cards with subtle shadow (shadow-sm), rounded-lg, p-6
  - Large numerical value (text-3xl font-bold) with small label below

### Interactive Map Component
- USA map container: bg-white rounded-lg shadow-sm p-6 mb-6
- Height: h-96 (24rem/384px)
- Map markers: Circular pins with green/red fill indicating status
- Tooltip on hover showing truck name and location

### Data Table
- White background with border (border border-gray-200 rounded-lg)
- Sticky header row (bg-gray-50)
- Zebra striping: even rows bg-gray-50/50
- Cell alignment: Left for text, right for numerical data
- Status badges: Inline rounded-full px-2 py-1 text-xs
  - Green: bg-green-100 text-green-800
  - Red: bg-red-100 text-red-800
- Row hover: bg-gray-50 cursor-pointer transition
- Sortable headers with icon indicators (Heroicons)

### Truck Detail View
- Slide-in panel from right (w-1/3 min) or modal overlay
- Header: Truck name, model, status badge
- Current Metrics Grid: 2x2 grid showing live values
  - Large value display (text-2xl font-semibold)
  - Unit labels below (text-xs text-gray-500)
- Historical Charts Section:
  - 4 line charts stacked vertically (State of Charge, Voltage, Current, Watts)
  - Chart library: Chart.js via CDN
  - Chart styling: Thin lines (2px), subtle grid, no background fill
  - Time axis at bottom, clear Y-axis labels
  - Consistent height: h-48 per chart

### Status Indicators
- Circular dot (h-2 w-2 rounded-full) inline with truck names
- Green (#10B981): In service
- Red (#EF4444): Not in service
- Pulsing animation for active trucks (animate-pulse subtle)

---

## Icons
**Library**: Heroicons (outline style) via CDN
- Navigation icons: 20px
- Table action icons: 16px
- Status indicators: Use colored dots, not icons

---

## Data Visualization
- Clean, minimal chart styling with subtle gridlines
- Use single accent color for data lines: #3B82F6 (blue-500)
- X-axis: Time labels, Y-axis: Value with units
- No chart backgrounds - transparent
- Tooltip on hover showing precise values

---

## Interaction Patterns
- Table row selection: Click entire row to open detail view
- Sortable columns: Click header to toggle sort direction
- Map markers: Hover for quick info, click to select truck and open detail
- No page transitions - all interactions within single-page application
- Loading states: Subtle skeleton screens with gray-200 shimmer

---

## Responsive Considerations
- Desktop-first design (primary use case: monitoring stations)
- Breakpoint adaptation: Sidebar collapses to top nav on <1024px
- Table scrolls horizontally on mobile with sticky first column
- Metric cards stack to 2-column then 1-column on smaller screens

---

## Accessibility
- High contrast text (gray-900 on white)
- Clear focus indicators (ring-2 ring-blue-500)
- Semantic HTML table structure with proper headers
- ARIA labels for status badges and interactive elements
- Keyboard navigation for all interactive components