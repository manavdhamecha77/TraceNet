# DRISHTI - UI/UX Design Specification

## HAVE SEPRATE ROUTES FOR SEPRATE PAGES (use recat router)

## 1. Design Philosophy
The DRISHTI interface must feel like a native, professional forensic tool. 
- **Information Density:** High. Use standard, readable font sizes (13px - 14px base) rather than large, consumer-app typography. 
- **Structure:** Crisp, bordered sections with subtle contrast. Avoid heavy drop-shadows; rely on 1px borders (`#E0E0E0` in light mode, `#333333` in dark mode) to define spaces.
- **Utilitarian:** Function over form. The user's focus must remain entirely on the video footage and search metadata.

---

## 2. Color Palette
The primary theme relies on professional Slate/Gray tones with Light Teal for primary actions and Amber for alerts/highlights.

### Light Mode (Default)
- **Background (Main Workspace):** `#F8F9FA` (Very light gray)
- **Surface (Cards/Panels/Sidebar):** `#FFFFFF` (Pure white)
- **Primary Brand (Teal):** `#0F766E` (Tailwind: teal-700) - *Used for active states, primary buttons, links.*
- **Accent/Highlight (Amber):** `#D97706` (Tailwind: amber-600) - *Used for bounding boxes, search match highlights, warnings.*
- **Text (Primary):** `#1F2937` (Gray-800)
- **Text (Secondary):** `#4B5563` (Gray-600)
- **Borders:** `#E5E7EB` (Gray-200)

### Dark Mode
- **Background (Main Workspace):** `#111827` (Gray-900)
- **Surface (Cards/Panels/Sidebar):** `#1F2937` (Gray-800)
- **Primary Brand (Teal):** `#14B8A6` (Tailwind: teal-500)
- **Accent/Highlight (Amber):** `#F59E0B` (Tailwind: amber-500)
- **Text (Primary):** `#F9FAFB` (Gray-50)
- **Text (Secondary):** `#9CA3AF` (Gray-400)
- **Borders:** `#374151` (Gray-700)

---

## 3. Typography
- **Font Family:** `Inter`, `Roboto`, or system-ui.
- **Base Size:** `14px` (Tailwind: `text-sm`) for all standard UI controls, sidebar items, and table data.
- **Secondary Data:** `12px` (Tailwind: `text-xs`) for timestamps, metadata tags, and file sizes.
- **Headings:** Limit sizes. A page title should be `18px` or `20px` max, Medium or Semi-Bold weight. No giant headers.

---

## 4. Layout Architecture

### A. Top Menu Bar (App Bar)
*Acts like Google Sheets/Roboflow menu bar. It is compact and utilitarian.*
- **Height:** `44px` or `48px`.
- **Content (Left):** Contextual Breadcrumbs (e.g., `Cameras / CAM_042_AthwaGate / Inference Report`).
- **Content (Right):** System Status (e.g., "Indexing: 3 Jobs Pending"), Export Evidence Button (Teal), User Profile Avatar.
- **Styling:** Bottom border (`1px solid`), matching surface background. No shadows.

### B. The Sidebar (Collapsible)
- **Expanded Width:** `240px` | **Collapsed Width:** `64px`.
- **Styling:** Right border (`1px solid`). Matches surface color.
- **Navigation Items:** - Standard `14px` text, aligned left with a 16px monochrome icon.
  - Active state: Subtle Teal background (e.g., `rgba(15, 118, 110, 0.1)`) with Teal text/icon.
- **Bottom Section (Pinned):**
  - Settings.
  - **Theme Toggle:** A simple icon toggle (Sun/Moon) to switch between Light and Dark mode. Must remain visible even when collapsed.

### C. Main Workspace
- **Layout:** Flexbox/CSS Grid. Fills the remaining viewport `calc(100vh - 48px)`.
- **Padding:** Standard `24px` padding around the main content wrapper.
- **Content Containers:** Use flat cards with a `1px` border and `4px` border-radius (`rounded-md`). Do not use large rounding (`rounded-xl` or `rounded-2xl` scream "mobile app").

---

## 5. Component Specifics

### Inputs & Search Bar
- **Search Bar:** The core feature of DRISHTI. Should be prominent but standard height (`36px` or `40px`).
- **Styling:** Inset text, flat border, slight focus ring (Teal outline, `2px` spread) when active.

### Buttons
- **Primary:** Solid Teal background, white text, `4px` radius. Hover state slightly darkens the background.
- **Secondary:** Transparent background, `1px` border (Gray), dark gray text.
- **Height:** `32px` (Dense) or `36px` (Standard).

### Data Grids & Lists
- **Tables:** Used for listing cameras, tracking IDs, and audit logs.
- **Styling:** Alternating row colors (Zebra striping - very subtle) or simple `1px` bottom borders per row. Hover states on rows should use a very light gray/teal tint to help the eye track across data columns.
