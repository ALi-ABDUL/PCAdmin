import { Activity, Award, Ban, Bell, Building2, Cable, ClipboardList, CreditCard, FileText, Globe, Heart, History, List, Lock, Mail, MapPinned, Menu, MessageCircle, MessageSquare, Package, PackageMinus, PackageSearch, PackageX, Percent, Receipt, RefreshCw, ShieldCheck, ShoppingCart, Star as StarIcon, StickyNote, Store, Ticket, TrendingDown as TrendingDownIcon, Truck, Undo2, Upload, UserCheck, User as UserIcon, UserPlus, Users, Warehouse } from "lucide-react";
import { Analytics } from "../pages/Analytics";
import { Orders } from "../pages/Orders";
import { Products } from "../pages/ProductsList";
import { Suppliers } from "../pages/Suppliers";

export const ORDERS_NAV = [
  { id: "all",       label: "All Orders",         icon: ClipboardList, group: "Orders" },
  { id: "returns",   label: "Returns & Refunds",  icon: Undo2,         group: "Orders" },
  { id: "abandoned", label: "Abandoned Carts",    icon: ShoppingCart,  group: "Orders" },
];

export const PAYMENTS_NAV = [
  { id: "transactions", label: "All Transactions",       icon: Receipt,     group: "Payments" },
  { id: "refunds",      label: "Refunds & Chargebacks",  icon: Undo2,       group: "Payments" },
];

export const ORDER_STATUS_TABS = [
  { id: "",              label: "All" },
  { id: "new",           label: "New" },
  { id: "pending",       label: "Pending" },
  { id: "processing",    label: "Processing" },
  { id: "ready_to_ship", label: "Ready to Ship" },
  { id: "shipped",       label: "Shipped" },
  { id: "delivered",     label: "Delivered" },
  { id: "cancelled",     label: "Cancelled" },
];

export const TRANSACTION_STATUS_TABS = [
  { id: "",           label: "All" },
  { id: "successful", label: "Successful" },
  { id: "pending",    label: "Pending" },
  { id: "failed",     label: "Failed" },
];

export const SUPPLIER_NAV = [
  { id: "all",          label: "All Suppliers",        icon: List,           group: "Directory" },
  { id: "top",          label: "Top Suppliers",        icon: Award,          group: "Directory" },
  { id: "products",     label: "Supplier Products",    icon: PackageSearch,  group: "Sourcing" },
  { id: "orders",       label: "Supplier Orders",      icon: ClipboardList,  group: "Sourcing" },
  { id: "activity",     label: "Supplier Activity",    icon: History,        group: "Insights" },
];

export const CUSTOMER_NAV = [
  { id: "portal",     label: "My Orders Portal",    icon: ShieldCheck,    group: "Portal" },
  { id: "create",     label: "Create Customer",     icon: UserPlus,       group: "Manage" },
  { id: "import",     label: "Import Customers",    icon: Upload,         group: "Manage" },
  { id: "all",        label: "All Customers",       icon: List,           group: "Directory" },
  { id: "pending",    label: "Pending",             icon: History,        group: "Directory" },
  { id: "active",     label: "Active",              icon: UserCheck,      group: "Directory" },
  { id: "guest",      label: "Guest customers",     icon: UserIcon,       group: "Directory" },
  { id: "registered", label: "Registered customers",icon: Users,          group: "Directory" },
  { id: "messages",   label: "Customer messages",   icon: MessageCircle,  group: "Engagement" },
  { id: "top",        label: "Top customers",       icon: Award,          group: "Engagement" },
  { id: "addresses",  label: "Addresses",           icon: MapPinned,      group: "Data" },
  { id: "wishlist",   label: "Wishlist",            icon: Heart,          group: "Data" },
  { id: "reviews",    label: "Reviews",             icon: StarIcon,       group: "Data" },
  { id: "coupons",    label: "Coupons",             icon: Ticket,         group: "Marketing" },
  { id: "activity",   label: "Activity",            icon: History,        group: "Marketing" },
  { id: "notes",      label: "Notes",               icon: StickyNote,     group: "Marketing" },
  { id: "blocked",    label: "Blocked customers",   icon: Ban,            group: "Security" },
];

export const PRODUCT_NAV = [
  { id: "all",            label: "All Products",       icon: Package,         group: "Catalog" },
  { id: "low-stock",      label: "Low Stock",          icon: PackageMinus,    group: "Inventory" },
  { id: "out-of-stock",   label: "Out of Stock",       icon: PackageX,        group: "Inventory" },
  { id: "archived",       label: "Archived",           icon: Warehouse,       group: "Inventory" },
  { id: "price-alerts",   label: "Price Alerts",       icon: TrendingDownIcon, group: "Insights" },
];

/* --------------------------- Store Management nav ------------------------- */
export const STORE_NAV = [
  { id: "store-settings",      label: "Store Settings",       icon: Store,        group: "Configuration" },
  { id: "pricing-rules",       label: "Pricing Rules",        icon: Percent,      group: "Configuration" },
  { id: "scraper-schedule",    label: "Scraper Schedule",     icon: RefreshCw,    group: "Configuration" },
  { id: "payment-gateway",     label: "Payment Gateway",      icon: CreditCard,   group: "Configuration" },
  { id: "shipping-methods",    label: "Shipping Methods",     icon: Truck,        group: "Configuration" },
  { id: "postage-presets",     label: "Postage Presets",      icon: PackageSearch, group: "Configuration" },
  { id: "delivery-estimate",   label: "Delivery Estimate",    icon: Truck,        group: "Configuration" },
  { id: "tax-rates",           label: "Tax Rates",            icon: Receipt,      group: "Configuration" },
  { id: "checkout-settings",   label: "Checkout Settings",    icon: ShoppingCart, group: "Configuration" },
  { id: "email-notifications", label: "Email & Notifications",icon: Mail,         group: "Content" },
  { id: "popup-messages",      label: "Popup Messages",       icon: MessageSquare,group: "Content" },
  { id: "site-menus",          label: "Site Menus",           icon: Menu,         group: "Content" },
  { id: "pages",               label: "Pages",                icon: FileText,     group: "Content" },
  { id: "locations",           label: "Locations",            icon: Building2,    group: "Business" },
  { id: "seo-settings",        label: "SEO Settings",         icon: Globe,        group: "Marketing" },
  { id: "analytics-tracking",  label: "Analytics & Tracking", icon: Activity,     group: "Marketing" },
  { id: "integrations",        label: "Integrations",         icon: Cable,        group: "Advanced" },
  { id: "security",            label: "Security",             icon: Lock,         group: "Advanced" },
];

export const ORDER_STATUS_STYLE = {
  new:           "chip-primary",
  pending:       "chip-warning",
  processing:    "chip-primary",
  ready_to_ship: "chip-warning",
  shipped:       "chip-primary",
  delivered:     "chip-success",
  cancelled:     "chip-danger",
  paid:          "chip-primary",
  refunded:      "chip-warning",
};
export const ORDER_STATUSES = ["new", "pending", "processing", "ready_to_ship", "shipped", "delivered", "cancelled"];

