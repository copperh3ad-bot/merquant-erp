import Dashboard from './pages/Dashboard';
import PurchaseOrders from './pages/PurchaseOrders';
import PODetail from './pages/PODetail';
import Suppliers from './pages/Suppliers';
import Shipments from './pages/Shipments';
import ShippingDocuments from './pages/ShippingDocuments';
import Production from './pages/Production';
import Reports from './pages/Reports';
import AIAssistant from './pages/AIAssistant';
import FabricWorking from './pages/FabricWorking';
import Articles from './pages/Articles';
import YarnPlanning from './pages/YarnPlanning';
import Trims from './pages/Trims';
import PackagingPlanning from './pages/PackagingPlanning';
import AccessoryPurchaseOrders from './pages/AccessoryPurchaseOrders';
import ProformaInvoice from './pages/ProformaInvoice';
import EmailCrawler from './pages/EmailCrawler';
import SKUReviewQueue from './pages/SKUReviewQueue';
import TNACalendar from './pages/TNACalendar';
import LabDips from './pages/LabDips';
import Samples from './pages/Samples';
import QCInspections from './pages/QCInspections';
import CostingSheet from './pages/CostingSheet';
import Payments from './pages/Payments';
import PackingList from './pages/PackingList';
import Compliance from './pages/Compliance';
import FabricOrders from './pages/FabricOrders';
import SeasonPlanning from './pages/SeasonPlanning';
import UserManagement from './pages/UserManagement';
import JobCards from './pages/JobCards';
import CommercialInvoices from './pages/CommercialInvoices';
import TechPacks from './pages/TechPacks';
import AccessoriesTrimsApproval from './pages/AccessoriesTrimsApproval';
import CRM from './pages/CRM';
import BuyerContacts from './pages/BuyerContacts';
import SupplierPerformance from './pages/SupplierPerformance';
import Templates from './pages/Templates';
import GmailCallback from './pages/GmailCallback';
import PendingApproval from './pages/PendingApproval';
import AuditDashboard from './pages/AuditDashboard';
import Settings from './pages/Settings';
import POVariance from './pages/POVariance';
import RMCoverage from './pages/RMCoverage';
import ConsumptionLibrary from './pages/ConsumptionLibrary';
import CapacityPlanning from './pages/CapacityPlanning';
import WIPTracker from './pages/WIPTracker';
import ProductionDashboard from './pages/ProductionDashboard';
import CustomerOrderStatus from './pages/CustomerOrderStatus';
import ShortageAlerts from './pages/ShortageAlerts';
import MasterDataImport from './pages/MasterDataImport';
import Layout from './Layout.jsx';

export const PAGES = {
  "Dashboard":                Dashboard,
  "PurchaseOrders":           PurchaseOrders,
  "PODetail":                 PODetail,
  "Suppliers":                Suppliers,
  "Shipments":                Shipments,
  "ShippingDocuments":        ShippingDocuments,
  "Production":               Production,
  "Reports":                  Reports,
  "AIAssistant":              AIAssistant,
  "FabricWorking":            FabricWorking,
  "Articles":                 Articles,
  "YarnPlanning":             YarnPlanning,
  "Trims":                    Trims,
  "AccessoriesPackaging":     PackagingPlanning,
  "PackagingPlanning":        PackagingPlanning,
  "AccessoryPurchaseOrders":  AccessoryPurchaseOrders,
  "ProformaInvoice":          ProformaInvoice,
  "EmailCrawler":             EmailCrawler,
  "SKUReviewQueue":           SKUReviewQueue,
  "TNACalendar":              TNACalendar,
  "LabDips":                  LabDips,
  "Samples":                  Samples,
  "QCInspections":            QCInspections,
  "CostingSheet":             CostingSheet,
  "Payments":                 Payments,
  "PackingList":              PackingList,
  "Compliance":               Compliance,
  "FabricOrders":             FabricOrders,
  "SeasonPlanning":           SeasonPlanning,
  "UserManagement":           UserManagement,
  "JobCards":                 JobCards,
  "CommercialInvoices":       CommercialInvoices,
  "TechPacks":                TechPacks,
  "PrintLayouts":             AccessoriesTrimsApproval,
  "CRM":                      CRM,
  "BuyerContacts":            BuyerContacts,
  "SupplierPerformance":      SupplierPerformance,
  "Settings":                Settings,
  POVariance,
  RMCoverage,
  ConsumptionLibrary,
  CapacityPlanning,
  WIPTracker,
  ProductionDashboard,
  CustomerOrderStatus,
  ShortageAlerts,
  MasterDataImport,
  "auth/gmail-callback":     GmailCallback,
  PendingApproval,
  AuditDashboard,
};

export const pagesConfig = {
  mainPage: "Dashboard",
  Pages: PAGES,
  Layout: Layout,
};


