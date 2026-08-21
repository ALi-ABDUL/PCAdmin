#!/usr/bin/env python3
"""Split App.js into modular files (writes real output)."""
import re
import os
from pathlib import Path

SRC = Path('/app/frontend/src')
APP = SRC / 'App.js'

original = APP.read_text()
lines = original.splitlines(keepends=True)

def slice_lines(start, end):
    return ''.join(lines[start-1:end])

# ---------------------------------------------------------------------------
# Extraction map
# ---------------------------------------------------------------------------
BLOCKS = {
    'lib/api.js': [(25, 32)],
    'lib/format.js': [(33, 38), (2002, 2003)],
    'lib/pricing.js': [(39, 88)],
    'lib/nav.js': [(89, 176), (1991, 2001), (2074, 2075)],
    'lib/portal-auth.js': [(1345, 1369)],
    'components/icons.jsx': [(318, 331)],
    'components/layout.jsx': [(332, 451)],
    'components/header.jsx': [(452, 791)],
    'components/atoms.jsx': [
        (1074, 1087), (1665, 1677), (3330, 3334), (3335, 3355),
        (3356, 3365), (4358, 4365), (4933, 4937), (5140, 5148),
    ],
    'components/modals/OrderDetailsModal.jsx': [(2076, 2130)],
    'components/modals/ItemModal.jsx': [(4990, 5139), (5149, 5197)],
    'components/modals/ProductEditModal.jsx': [(3956, 4075)],
    'components/modals/CategoryEditModal.jsx': [(4294, 4357)],
    'pages/Suppliers.jsx': [(792, 1012)],
    'pages/Customers.jsx': [(1013, 1073), (1088, 1253), (1650, 1708)],
    'pages/CustomerPortal.jsx': [(1370, 1649)],
    'pages/Products.jsx': [(1709, 1969)],
    'pages/Orders.jsx': [(1970, 1990), (2004, 2073), (2131, 2227), (4740, 4774)],
    'pages/ProductDetail.jsx': [(3589, 3851)],
    'pages/OrderDetail.jsx': [(3852, 3955)],
    'pages/Payments.jsx': [(2228, 2348)],
    'pages/Store.jsx': [(2349, 3140)],
    'pages/Dashboard.jsx': [(3141, 3329)],
    'pages/Categories.jsx': [(4076, 4293)],
    'pages/Scraper.jsx': [(4366, 4739)],
    'pages/Analytics.jsx': [(4775, 4932)],
    'pages/Settings.jsx': [(4938, 4989)],
    'pages/ProductsList.jsx': [(3366, 3529)],
    'pages/ArchivedProducts.jsx': [(3530, 3588)],
}

# ---------------------------------------------------------------------------
# Build symbol → module map
# ---------------------------------------------------------------------------
SYMBOL_TO_MODULE = {}
for module, ranges in BLOCKS.items():
    for (s, e) in ranges:
        for i in range(s-1, e):
            m = re.match(r'^(?:export default function|export function|export const|function|const)\s+(\w+)', lines[i])
            if m:
                sym = m.group(1)
                if sym.startswith('_'):
                    continue  # private helpers stay local
                if sym not in SYMBOL_TO_MODULE:
                    SYMBOL_TO_MODULE[sym] = module

SYMBOL_TO_MODULE.setdefault('humaniseStatus', 'lib/format.js')
SYMBOL_TO_MODULE.setdefault('ORDER_STATUSES', 'lib/nav.js')
SYMBOL_TO_MODULE.setdefault('ORDER_STATUS_STYLE', 'lib/nav.js')

# Symbols exported by App.js top-level scope
APP_SYMBOLS = {'API'}  # API is used everywhere → put in lib/api.js

# ---------------------------------------------------------------------------
# Lucide icons known
# ---------------------------------------------------------------------------
LUCIDE_ALIASES = {
    'UserIcon': 'User as UserIcon',
    'LineChartIcon': 'LineChart as LineChartIcon',
    'TrendingDownIcon': 'TrendingDown as TrendingDownIcon',
    'StarIcon': 'Star as StarIcon',
    'ImageLucide': 'Image as ImageLucide',
    'BoxesIcon': 'Boxes as BoxesIcon',
    'ClockIcon': 'Clock as ClockIcon',
}
LUCIDE_ICON_NAMES = [
    'LayoutDashboard','Package','Zap','ShoppingCart','Users','BarChart3','Settings2','Search','Eye','EyeOff',
    'Loader2','Trash2','Star','RefreshCw','MapPin','Truck','UserIcon','Box','ExternalLink',
    'X','ChevronLeft','ChevronRight','ClipboardPaste','Plus','TrendingUp','TrendingDown','DollarSign','Pencil',
    'ShoppingBag','Percent','Boxes','ArrowUpRight','Filter','Download','ImageIcon','Sparkles',
    'Smartphone','Laptop','Tv','Headphones','Camera','Gamepad2','Watch','Utensils','Armchair','Lamp',
    'Bed','SprayCan','Flower2','Wrench','Car','Hammer','Shield','Shirt','Footprints','Dumbbell','Tent',
    'Bike','Blocks','Puzzle','Tags','Palette',
    'Store','CreditCard','Receipt','Undo2','Mail','MessageSquare','Menu','Layout','FileText','Building2',
    'Globe','Activity','Cable','Lock','ChevronDown','Bell','BellOff','HelpCircle',
    'Factory','UserPlus','Upload','List','Award','ShieldCheck','PackageSearch','ClipboardList','LineChartIcon','TrendingDownIcon','History','BadgeCheck','StarIcon','CheckCircle2',
    'UserCheck','UserX','Users2','Heart','MessageCircle','Ticket','MapPinned','StickyNote','Ban','Layers',
    'ImageLucide','GitBranch','Calculator','BoxesIcon','PackagePlus','PackageMinus','PackageX','Warehouse','ClipboardCheck','XCircle','AlertTriangle','ClockIcon',
]
LUCIDE_SET = set(LUCIDE_ICON_NAMES)

RECHARTS_NAMES = {'LineChart','Line','AreaChart','Area','BarChart','Bar','PieChart','Pie','Cell',
                  'ResponsiveContainer','Tooltip','XAxis','YAxis','CartesianGrid'}
# Note: LineChart in recharts conflicts with LineChartIcon (lucide). We keep them separate.

REACT_HOOKS = {'useState','useEffect','useCallback','useRef','useMemo'}
FRAMER = {'motion','AnimatePresence'}
SONNER = {'toast','Toaster'}

# ---------------------------------------------------------------------------
# For each output file, determine content + imports
# ---------------------------------------------------------------------------
def rel_import_path(from_module, to_module):
    """Compute relative import path from `from_module` to `to_module`.
    Both are relative to SRC. Return path suitable for JS import (no extension for js/jsx)."""
    from_dir = os.path.dirname(from_module)
    # Strip .js/.jsx extension for import statement
    to_no_ext = to_module.rsplit('.', 1)[0]
    rel = os.path.relpath(to_no_ext, from_dir)
    if not rel.startswith('.'):
        rel = './' + rel
    return rel

def build_file(target, ranges):
    body = ''.join(slice_lines(s, e) for (s, e) in ranges)
    # Convert `function XYZ` at column 0 → `export function XYZ` (only top-level)
    body = re.sub(r'^function ', 'export function ', body, flags=re.MULTILINE)
    body = re.sub(r'^const ', 'export const ', body, flags=re.MULTILINE)
    # Detect referenced symbols
    tokens = set(re.findall(r'\b[A-Za-z_][A-Za-z0-9_]*\b', body))
    # Determine self-defined symbols (to exclude from imports)
    self_syms = set()
    for m in re.finditer(r'^export\s+(?:function|const)\s+(\w+)', body, flags=re.MULTILINE):
        self_syms.add(m.group(1))
    # Referenced external symbols from our modules
    ext_imports = {}  # module -> [symbols]
    for sym in tokens - self_syms:
        if sym in SYMBOL_TO_MODULE and SYMBOL_TO_MODULE[sym] != target:
            ext_imports.setdefault(SYMBOL_TO_MODULE[sym], []).append(sym)
    # API is a special symbol that lives in lib/api.js
    if 'API' in tokens and 'API' not in self_syms:
        ext_imports.setdefault('lib/api.js', []).append('API')
    # Detect icons
    icons_used = tokens & LUCIDE_SET
    # Detect react hooks
    hooks_used = tokens & REACT_HOOKS
    # Detect framer
    framer_used = tokens & FRAMER
    # Detect sonner
    sonner_used = tokens & SONNER
    # Detect recharts (only used in Dashboard, Analytics, ItemModal charts, Store)
    recharts_used = tokens & RECHARTS_NAMES
    # Detect axios
    uses_axios = 'axios' in tokens
    # Motion (react library)
    # Assemble imports
    imports = []
    if hooks_used:
        imports.append(f'import {{ {", ".join(sorted(hooks_used))} }} from "react";')
    if uses_axios:
        imports.append('import axios from "axios";')
    if sonner_used:
        imports.append(f'import {{ {", ".join(sorted(sonner_used))} }} from "sonner";')
    if framer_used:
        imports.append(f'import {{ {", ".join(sorted(framer_used))} }} from "framer-motion";')
    if icons_used:
        icon_import_names = []
        for i in sorted(icons_used):
            icon_import_names.append(LUCIDE_ALIASES.get(i, i))
        imports.append(f'import {{ {", ".join(icon_import_names)} }} from "lucide-react";')
    if recharts_used:
        imports.append(f'import {{ {", ".join(sorted(recharts_used))} }} from "recharts";')
    for mod in sorted(ext_imports.keys()):
        syms = sorted(set(ext_imports[mod]))
        rel = rel_import_path(target, mod)
        imports.append(f'import {{ {", ".join(syms)} }} from "{rel}";')
    header = '\n'.join(imports) + '\n\n' if imports else ''
    return header + body

# ---------------------------------------------------------------------------
# Write files
# ---------------------------------------------------------------------------
for target, ranges in BLOCKS.items():
    content = build_file(target, ranges)
    out = SRC / target
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(content)
    print(f"WROTE {target}  ({len(content)} chars, {content.count(chr(10))} lines)")

# ---------------------------------------------------------------------------
# Build final App.js
# ---------------------------------------------------------------------------
# App.js needs: imports + App() function
app_body = slice_lines(177, 317)  # App() function

# Detect symbols referenced by App()
tokens = set(re.findall(r'\b[A-Za-z_][A-Za-z0-9_]*\b', app_body))
ext_imports = {}
for sym in tokens:
    if sym in SYMBOL_TO_MODULE:
        ext_imports.setdefault(SYMBOL_TO_MODULE[sym], []).append(sym)
if 'API' in tokens:
    ext_imports.setdefault('lib/api.js', []).append('API')

icons_used = tokens & LUCIDE_SET
hooks_used = tokens & REACT_HOOKS
framer_used = tokens & FRAMER
sonner_used = tokens & SONNER
uses_axios = 'axios' in tokens

imports = ['import "@/App.css";']
if hooks_used:
    imports.append(f'import {{ {", ".join(sorted(hooks_used))} }} from "react";')
if uses_axios:
    imports.append('import axios from "axios";')
if sonner_used:
    imports.append(f'import {{ {", ".join(sorted(sonner_used))} }} from "sonner";')
if framer_used:
    imports.append(f'import {{ {", ".join(sorted(framer_used))} }} from "framer-motion";')
if icons_used:
    icon_names = [LUCIDE_ALIASES.get(i, i) for i in sorted(icons_used)]
    imports.append(f'import {{ {", ".join(icon_names)} }} from "lucide-react";')
for mod in sorted(ext_imports.keys()):
    syms = sorted(set(ext_imports[mod]))
    rel = rel_import_path('App.js', mod)
    imports.append(f'import {{ {", ".join(syms)} }} from "{rel}";')

app_out = '\n'.join(imports) + '\n\n' + app_body
APP.write_text(app_out)
print(f"WROTE App.js  ({len(app_out)} chars, {app_out.count(chr(10))} lines)")
