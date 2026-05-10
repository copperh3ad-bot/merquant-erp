// orders
import Dashboard from './modules/orders/pages/Dashboard';
import PurchaseOrders from './modules/orders/pages/PurchaseOrders';
import PODetail from './modules/orders/pages/PODetail';
import SeasonPlanning from './modules/orders/pages/SeasonPlanning';
import EmailCrawler from './modules/orders/pages/EmailCrawler';
import AIExtractionReview from './modules/orders/pages/AIExtractionReview';
import CustomerOrderStatus from './modules/orders/pages/CustomerOrderStatus';

// tracking
import TechPacks from './modules/tracking/pages/TechPacks';
import TNACalendar from './modules/tracking/pages/TNACalendar';
import ShortageAlerts from './modules/tracking/pages/ShortageAlerts';
import SKUReviewQueue from './modules/tracking/pages/SKUReviewQueue';
import LabDips from './modules/tracking/pages/LabDips';
import Samples from './modules/tracking/pages/Samples';
import QCInspections from './modules/tracking/pages/QCInspections';
import JobCards from './modules/tracking/pages/JobCards';
import AccessoriesTrimsApproval from './modules/tracking/pages/AccessoriesTrimsApproval';

// agents
import AgentMemory from './modules/agents/pages/AgentMemory';
import AgentActions from './modules/agents/pages/AgentActions';
import EmailPOAgent from './modules/agents/pages/EmailPOAgent';
import TNARiskAgent from './modules/agents/pages/TNARiskAgent';

// materials
import Articles from './modules/materials/pages/Articles';
import BOMCalculator from './modules/materials/pages/BOMCalculator';
import FabricWorking from './modules/materials/pages/FabricWorking';
import FabricOrders from './modules/materials/pages/FabricOrders';
import RMCoverage from './modules/materials/pages/RMCoverage';
import ConsumptionLibrary from './modules/materials/pages/ConsumptionLibrary';
import YarnPlanning from './modules/materials/pages/YarnPlanning';
import PackagingPlanning from './modules/materials/pages/PackagingPlanning';
import FabricInventory from './modules/materials/pages/FabricInventory';
import JobWork from './modules/materials/pages/JobWork';
import AccessoryPurchaseOrders from './modules/materials/pages/AccessoryPurchaseOrders';

// logistics
import Suppliers from './modules/logistics/pages/Suppliers';
import Shipments from './modules/logistics/pages/Shipments';
import CommercialInvoices from './modules/logistics/pages/CommercialInvoices';
import ShippingDocuments from './modules/logistics/pages/ShippingDocuments';
import Production from './modules/logistics/pages/Production';
import CapacityPlanning from './modules/logistics/pages/CapacityPlanning';
import WIPTracker from './modules/logistics/pages/WIPTracker';
import ProductionDashboard from './modules/logistics/pages/ProductionDashboard';
import ShopFloor from './modules/logistics/pages/ShopFloor';
import PackingList from './modules/logistics/pages/PackingList';
import ProformaInvoice from './modules/logistics/pages/ProformaInvoice';

// finance
import CostingSheet from './modules/finance/pages/CostingSheet';
import POVariance from './modules/finance/pages/POVariance';
import Payments from './modules/finance/pages/Payments';
import Compliance from './modules/finance/pages/Compliance';
import Reports from './modules/finance/pages/Reports';

// crm
import BuyerPortal from './modules/crm/pages/BuyerPortal';
import CRM from './modules/crm/pages/CRM';
import BuyerContacts from './modules/crm/pages/BuyerContacts';
import SupplierPerformance from './modules/crm/pages/SupplierPerformance';

// admin
import UserManagement from './modules/admin/pages/UserManagement';
import MasterDataImport from './modules/admin/pages/MasterDataImport';
import Settings from './modules/admin/pages/Settings';
import AuditDashboard from './modules/admin/pages/AuditDashboard';
import ErrorLogs from './modules/admin/pages/ErrorLogs';
import Templates from './modules/admin/pages/Templates';

// ai
import AIAssistant from './modules/ai/pages/AIAssistant';
import FileFeeder from './modules/ai/pages/FileFeeder';

// auth
import GmailCallback from './auth/pages/GmailCallback';
import PendingApproval from './auth/pages/PendingApproval';

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
  ShopFloor,
  FabricInventory,
  JobWork,
  BuyerPortal,
  CustomerOrderStatus,
  ShortageAlerts,
  MasterDataImport,
  AIExtractionReview,
  FileFeeder,
  AgentMemory,
  AgentActions,
  EmailPOAgent,
  TNARiskAgent,
  BOMCalculator,
  "auth/gmail-callback":     GmailCallback,
  PendingApproval,
  AuditDashboard,
  ErrorLogs,
};

export const pagesConfig = {
  mainPage: "Dashboard",
  Pages: PAGES,
  Layout: Layout,
};

