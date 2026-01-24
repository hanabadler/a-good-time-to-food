import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import QRCode from 'qrcode';
import { 
  Users, Package, Plus, Edit, Trash2, History, X, Save, 
  UserPlus, PackagePlus, Calendar, Clock, ArrowRightLeft, 
  FileText, AlertCircle, Wallet, CreditCard, Banknote, CheckCircle2
} from 'lucide-react';
import './AdminPanel.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function AdminPanel() {
  const [activeTab, setActiveTab] = useState('members');
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDepositsModal, setShowDepositsModal] = useState(false);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [allocationReport, setAllocationReport] = useState(null);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [credentialsPayload, setCredentialsPayload] = useState(null); // { name, clientCode, totpOtpauthUrl }
  const [credentialsQr, setCredentialsQr] = useState({ client: '', totp: '' });
  const [editingMember, setEditingMember] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedProductHistory, setSelectedProductHistory] = useState(null);
  const [productTransactions, setProductTransactions] = useState([]);
  const [selectedProductDeposits, setSelectedProductDeposits] = useState(null);
  const [productDeposits, setProductDeposits] = useState([]);
  const [refundEligibleMemberIds, setRefundEligibleMemberIds] = useState(new Set());
  const [refundSelectionMemberId, setRefundSelectionMemberId] = useState('');
  const [lastRefundedMemberName, setLastRefundedMemberName] = useState('');
  
  const [memberForm, setMemberForm] = useState({ name: '', isChild: false, gender: '' });
  const [productForm, setProductForm] = useState({ 
    name: '', 
    quantity: '', 
    unit: '', 
    ruleType: 'everyone' 
  });
  const [importingChp, setImportingChp] = useState(false);
  const pendingMemberPasswordRef = useRef('');
  const pendingAdminPasswordRef = useRef('');

  const promptMemberPassword = (memberName, actionLabel) => {
    const pw = window.prompt(`סיסמה עבור ${memberName} נדרשת עבור: ${actionLabel}`, '');
    if (!pw) return null;
    return pw;
  };

  const promptAdminPassword = (actionLabel) => {
    const pw = window.prompt(`סיסמת אדמין נדרשת עבור: ${actionLabel}`, '');
    if (!pw) return null;
    return pw;
  };

  const promptAddProductPassword = () => {
    const pw = window.prompt('סיסמה להוספת מוצר:', '');
    if (!pw) return null;
    if (pw !== '2014') {
      alert('סיסמה שגויה.');
      return null;
    }
    return pw;
  };

  const promptDeleteProductPassword = () => {
    const pw = window.prompt('סיסמה למחיקת מוצר:', '');
    if (!pw) return null;
    if (pw !== '2014') {
      alert('סיסמה שגויה.');
      return null;
    }
    return pw;
  };

  const promptBulkDeleteProductsPassword = () => {
    const pw = window.prompt('סיסמה למחיקה גורפת של מוצרים:', '');
    if (!pw) return null;
    if (pw !== '2014') {
      alert('סיסמה שגויה.');
      return null;
    }
    return pw;
  };

  const passwordHeaders = (pw) => ({
    headers: { 'x-admin-password': pw }
  });

  useEffect(() => {
    fetchData();
  }, []);

  const openCredentialsModal = async ({ name, clientCode, totpOtpauthUrl }) => {
    try {
      const [clientQr, totpQr] = await Promise.all([
        // Keep this QR максимально פשוט (UUID בלבד) כדי לשפר זיהוי מהמסך
        QRCode.toDataURL(String(clientCode), {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 420,
          color: { dark: '#000000', light: '#FFFFFF' }
        }),
        // TOTP QR: אפשר להשאיר otpauth, אבל להגדיל ולתת error correction גבוה
        QRCode.toDataURL(String(totpOtpauthUrl), {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 320,
          color: { dark: '#000000', light: '#FFFFFF' }
        })
      ]);

      setCredentialsPayload({ name, clientCode, totpOtpauthUrl });
      setCredentialsQr({ client: clientQr, totp: totpQr });
      setShowCredentialsModal(true);
    } catch (e) {
      console.error('Error generating QR codes:', e);
      alert('שגיאה ביצירת קודי QR');
    }
  };

  const fetchData = async () => {
    try {
      const [membersRes, productsRes] = await Promise.all([
        axios.get(`${API_URL}/family-members`),
        axios.get(`${API_URL}/products`)
      ]);
      setMembers(membersRes.data);
      setProducts(productsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const handleShowHistory = async (product) => {
    try {
      const pw = promptAdminPassword('הצג היסטוריה');
      if (!pw) return;
      setSelectedProductHistory(product);
      const [transactionsRes, transfersRes] = await Promise.all([
        axios.get(`${API_URL}/transactions`, passwordHeaders(pw)),
        axios.get(`${API_URL}/share-transfers?productId=${product.id}`, passwordHeaders(pw))
      ]);
      
      // Filter transactions for this product
      const productTrans = transactionsRes.data.filter(t => t.productId === product.id);
      
      // Combine and sort by date (newest first)
      const allActivity = [
        ...productTrans.map(t => ({ ...t, type: 'transaction' })),
        ...transfersRes.data.map(t => ({ ...t, type: 'transfer' }))
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      setProductTransactions(allActivity);
      setShowHistoryModal(true);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      alert('שגיאה בטעינת ההיסטוריה');
    }
  };

  const handleShowAllocationReport = async (product) => {
    try {
      const pw = promptAdminPassword('דוח חלוקה');
      if (!pw) return;
      const res = await axios.get(`${API_URL}/products/${product.id}/allocation-report`, passwordHeaders(pw));
      setAllocationReport(res.data);
      setShowAllocationModal(true);
    } catch (error) {
      console.error('Error fetching allocation report:', error);
      alert(error.response?.data?.error || 'שגיאה בטעינת דוח חלוקה');
    }
  };

  const handleShowDeposits = async (product) => {
    try {
      const pw = promptAdminPassword('פיקדונות');
      if (!pw) return;
      setSelectedProductDeposits(product);
      setRefundSelectionMemberId('');
      setLastRefundedMemberName('');
      const [depositsRes, transactionsRes] = await Promise.all([
        axios.get(`${API_URL}/deposits?productId=${product.id}`, passwordHeaders(pw)),
        axios.get(`${API_URL}/transactions`, passwordHeaders(pw))
      ]);

      const deposits = depositsRes.data || [];
      // Refund is allowed even if user did not take the product
      const eligibleIds = new Set(deposits.map(d => d.memberId));

      setRefundEligibleMemberIds(eligibleIds);
      setProductDeposits(deposits);
      setShowDepositsModal(true);
    } catch (error) {
      console.error('Error fetching deposits:', error);
      alert('שגיאה בטעינת הפיקדונות');
    }
  };

  const handleRefundDeposit = async (memberId) => {
    try {
      if (!selectedProductDeposits) return;
      const pw = promptAdminPassword('החזרת פיקדון');
      if (!pw) return;
      const refundedDeposit = productDeposits.find(d => d.memberId === parseInt(memberId));

      await axios.post(`${API_URL}/deposits/refund`, {
        productId: selectedProductDeposits.id,
        memberId: parseInt(memberId)
      }, passwordHeaders(pw));

      alert('הפיקדון הוחזר');
      setLastRefundedMemberName(refundedDeposit?.member?.name || '');

      // Refresh deposits list
      const depositsRes = await axios.get(`${API_URL}/deposits?productId=${selectedProductDeposits.id}`, passwordHeaders(pw));
      setProductDeposits(depositsRes.data || []);
      setRefundSelectionMemberId('');
    } catch (error) {
      console.error('Error refunding deposit:', error);
      alert(error.response?.data?.error || 'שגיאה בהחזרת הפיקדון');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPaymentLabel = (paymentMethod) => {
    if (paymentMethod === 'cash') return 'מזומן';
    if (paymentMethod === 'card') return 'כרטיס אשראי';
    return paymentMethod || '-';
  };

  const handleMemberSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingMember) {
        const pw =
          pendingMemberPasswordRef.current ||
          promptMemberPassword(editingMember?.name || 'משתמש', 'עריכת משתמש');
        if (!pw) return;
        await axios.put(`${API_URL}/family-members/${editingMember.id}`, memberForm, passwordHeaders(pw));
        pendingMemberPasswordRef.current = '';
      } else {
        const pw = pendingAdminPasswordRef.current || promptAdminPassword('הוספת משתמש');
        if (!pw) return;
        const res = await axios.post(`${API_URL}/family-members`, memberForm, passwordHeaders(pw));
        pendingAdminPasswordRef.current = '';
        if (res?.data?.clientCode && res?.data?.totpOtpauthUrl) {
          await openCredentialsModal({
            name: res.data.name,
            clientCode: res.data.clientCode,
            totpOtpauthUrl: res.data.totpOtpauthUrl
          });
        }
      }
      setShowMemberModal(false);
      setEditingMember(null);
      setMemberForm({ name: '', isChild: false, gender: '' });
      fetchData();
    } catch (error) {
      console.error('Error saving member:', error);
      alert('שגיאה בשמירת הנתונים');
    }
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    try {
      const pw =
        pendingAdminPasswordRef.current ||
        (editingProduct ? promptAdminPassword('עריכת מוצר') : promptAddProductPassword());
      if (!pw) return;
      if (editingProduct) {
        await axios.put(`${API_URL}/products/${editingProduct.id}`, productForm, passwordHeaders(pw));
      } else {
        // Defensive: never attempt add with non-2014
        if (pw !== '2014') {
          alert('סיסמה שגויה.');
          return;
        }
        await axios.post(`${API_URL}/products`, productForm, passwordHeaders(pw));
      }
      pendingAdminPasswordRef.current = '';
      setShowProductModal(false);
      setEditingProduct(null);
      setProductForm({ name: '', quantity: '', unit: '', ruleType: 'everyone' });
      fetchData();
    } catch (error) {
      console.error('Error saving product:', error);
      alert(error.response?.data?.error || 'שגיאה בשמירת הנתונים');
    }
  };

  const handleImportFromChp = async () => {
    const query = window.prompt('מה לחפש ב-CHP? (שם מוצר או ברקוד)', 'מעדני מילקי');
    if (!query) return;
    setImportingChp(true);
    try {
      const pw = promptAdminPassword('ייבוא מ-CHP');
      if (!pw) return;
      const res = await axios.post(`${API_URL}/products/import/chp`, { query, limit: 120 }, passwordHeaders(pw));
      const imported = res.data?.imported ?? 0;
      const skipped = res.data?.skipped ?? 0;
      const warning = res.data?.warning;
      alert(
        warning
          ? `${warning}\n\nיובאו: ${imported}\nדולגו (כבר קיימים): ${skipped}`
          : `ייבוא הושלם.\nיובאו: ${imported}\nדולגו (כבר קיימים): ${skipped}`
      );
      fetchData();
    } catch (error) {
      console.error('Error importing from CHP:', error);
      alert(error.response?.data?.error || 'שגיאה בייבוא מ-CHP');
    } finally {
      setImportingChp(false);
    }
  };

  const handleBulkDeleteProducts = async () => {
    const first = window.confirm('מחיקה גורפת תמחק את *כל* המוצרים (ועלולה למחוק גם היסטוריה/תנועות הקשורות למוצרים). להמשיך?');
    if (!first) return;
    const phrase = window.prompt('כדי לאשר מחיקה, הקלד: DELETE', '');
    if (phrase !== 'DELETE') return;

    try {
      const pw = promptBulkDeleteProductsPassword();
      if (!pw) return; // also shows "סיסמה שגויה." if wrong
      const res = await axios.post(`${API_URL}/products/bulk-delete`, { confirm: 'DELETE_ALL_PRODUCTS' }, passwordHeaders(pw));
      alert(`נמחקו ${res.data?.deleted ?? 0} מוצרים`);
      fetchData();
    } catch (error) {
      console.error('Error bulk deleting products:', error);
      alert(error.response?.data?.error || 'שגיאה במחיקה גורפת');
    }
  };

  const handleDeleteMember = async (id) => {
    if (window.confirm('האם אתם בטוחים שברצונכם למחוק את חבר המשפחה?')) {
      try {
        const member = members.find((m) => m.id === id);
        const pw = promptMemberPassword(member?.name || 'משתמש', 'מחיקת משתמש');
        if (!pw) return;
        await axios.delete(`${API_URL}/family-members/${id}`, passwordHeaders(pw));
        fetchData();
      } catch (error) {
        console.error('Error deleting member:', error);
        alert(error.response?.data?.error || 'שגיאה במחיקת הנתונים');
      }
    }
  };

  const handleDeleteProduct = async (id) => {
    if (window.confirm('האם אתם בטוחים שברצונכם למחוק את המוצר?')) {
      try {
        const pw = promptDeleteProductPassword();
        if (!pw) return; // also shows "סיסמה שגויה." if wrong
        await axios.delete(`${API_URL}/products/${id}`, passwordHeaders(pw));
        fetchData();
      } catch (error) {
        console.error('Error deleting product:', error);
        alert(error.response?.data?.error || 'שגיאה במחיקת הנתונים');
      }
    }
  };

  const handleEditMember = (member) => {
    (async () => {
      try {
        const pw = promptMemberPassword(member?.name || 'משתמש', 'עריכת משתמש');
        if (!pw) return;

        // Validate immediately (same idea as "קודי כניסה")
        await axios.post(`${API_URL}/family-members/${member.id}/verify-password`, {}, passwordHeaders(pw));

        pendingMemberPasswordRef.current = pw;
        setEditingMember(member);
        setMemberForm({ name: member.name, isChild: member.isChild, gender: member.gender || '' });
        setShowMemberModal(true);
      } catch (error) {
        console.error('Error verifying member password:', error);
        alert(error.response?.data?.error || 'סיסמה שגויה');
      }
    })();
  };

  const handleShowMemberCredentials = async (member) => {
    try {
      const pw = promptMemberPassword(member?.name || 'משתמש', 'הצגת קודי כניסה');
      if (!pw) return;
      const res = await axios.post(`${API_URL}/family-members/${member.id}/credentials`, {}, passwordHeaders(pw));
      await openCredentialsModal({
        name: res.data.name,
        clientCode: res.data.clientCode,
        totpOtpauthUrl: res.data.totpOtpauthUrl
      });
      fetchData();
    } catch (error) {
      console.error('Error fetching member credentials:', error);
      alert(error.response?.data?.error || 'שגיאה בטעינת קודי כניסה');
    }
  };

  const handleResetMemberCredentials = async (member) => {
    try {
      if (!window.confirm('איפוס קודי כניסה ייצור QR חדש וגם ידרוש לסרוק מחדש את ה־Authenticator. להמשיך?')) return;
      const pw = promptMemberPassword(member?.name || 'משתמש', 'איפוס קודי כניסה');
      if (!pw) return;
      const res = await axios.post(`${API_URL}/family-members/${member.id}/credentials/reset`, {}, passwordHeaders(pw));
      await openCredentialsModal({
        name: res.data.name,
        clientCode: res.data.clientCode,
        totpOtpauthUrl: res.data.totpOtpauthUrl
      });
      fetchData();
    } catch (error) {
      console.error('Error resetting member credentials:', error);
      alert(error.response?.data?.error || 'שגיאה באיפוס קודי כניסה');
    }
  };

  const handleEditProduct = (product) => {
    const pw = promptAdminPassword('עריכת מוצר');
    if (!pw) return;
    pendingAdminPasswordRef.current = pw;
    setEditingProduct(product);
    const rule = product.rules && product.rules[0];
    setProductForm({
      name: product.name,
      quantity: product.quantity,
      unit: product.unit,
      ruleType: rule ? rule.ruleType : 'everyone'
    });
    setShowProductModal(true);
  };

  const getRuleLabel = (ruleType) => {
    const rules = {
      'everyone': 'כולם',
      'children_only': 'ילדים בלבד',
      'adults_only': 'מבוגרים בלבד'
    };
    return rules[ruleType] || ruleType;
  };

  return (
    <div className="admin-panel">
      <div className="container">
        <h1 className="page-title">ממשק ניהול</h1>
        
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            בני משפחה
          </button>
          <button 
            className={`tab ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            מוצרים
          </button>
        </div>

        {activeTab === 'members' && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Users size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                ניהול בני משפחה
              </h2>
              <button 
                className="btn btn-primary"
                onClick={() => {
                  const pw = promptAdminPassword('הוספת משתמש');
                  if (!pw) return;
                  pendingAdminPasswordRef.current = pw;
                  setEditingMember(null);
                  setMemberForm({ name: '', isChild: false, gender: '' });
                  setShowMemberModal(true);
                }}
              >
                <UserPlus size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                הוסף חבר משפחה
              </button>
            </div>
            
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>גיל</th>
                  <th>מגדר</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>
                      <span className={`badge ${member.isChild ? 'badge-info' : 'badge-success'}`}>
                        {member.isChild ? 'ילד' : 'מבוגר'}
                      </span>
                    </td>
                    <td>
                      {member.gender ? (
                        <span
                          className="badge badge-warning"
                          title={member.gender === 'male' ? 'זכר' : member.gender === 'female' ? 'נקבה' : 'אחר'}
                          style={{ fontSize: '1rem', lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          {member.gender === 'male' ? '♂️' : member.gender === 'female' ? '♀️' : '⚧️'}
                        </span>
                      ) : (
                        <span title="לא הוגדר" style={{ color: '#999', fontSize: '1rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      <button 
                        className="btn-small btn-info"
                        onClick={() => handleEditMember(member)}
                      >
                        ערוך
                      </button>
                      <button
                        className="btn-small btn-secondary"
                        onClick={() => handleShowMemberCredentials(member)}
                        style={{ marginRight: '0.5rem', backgroundColor: '#667eea', borderColor: '#667eea', color: '#fff' }}
                        title="הצגת קודי כניסה (קבועים)"
                      >
                        קודי כניסה
                      </button>
                      <button
                        className="btn-small btn-secondary"
                        onClick={() => handleResetMemberCredentials(member)}
                        style={{ marginRight: '0.5rem', backgroundColor: '#f57c00', borderColor: '#f57c00', color: '#fff' }}
                        title="איפוס קודי כניסה (מייצר חדשים)"
                      >
                        אפס קודים
                      </button>
                      <button 
                        className="btn-small btn-danger"
                        onClick={() => handleDeleteMember(member.id)}
                        style={{ marginRight: '0.5rem' }}
                      >
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Package size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                ניהול מוצרים
              </h2>
              {/* Import button hidden for now (not in use) */}
              <button
                className="btn btn-secondary"
                onClick={handleBulkDeleteProducts}
                style={{ marginRight: '0.75rem', backgroundColor: '#d32f2f', borderColor: '#d32f2f', color: '#fff' }}
                title="מחיקה גורפת של כל המוצרים"
              >
                מחק את כל המוצרים
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => {
                  const pw = promptAddProductPassword();
                  if (!pw) return;
                  pendingAdminPasswordRef.current = pw;
                  setEditingProduct(null);
                  setProductForm({ name: '', quantity: '', unit: '', ruleType: 'everyone' });
                  setShowProductModal(true);
                }}
              >
                <PackagePlus size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                הוסף מוצר
              </button>
            </div>
            
            <table className="table">
              <thead>
                <tr>
                  <th>שם מוצר</th>
                  <th>כמות</th>
                  <th>יחידה</th>
                  <th>חוק</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => {
                  const rule = product.rules && product.rules[0];
                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.quantity}</td>
                      <td>{product.unit || '-'}</td>
                      <td>
                        <span className="badge badge-warning">
                          {getRuleLabel(rule ? rule.ruleType : 'everyone')}
                        </span>
                      </td>
                      <td>
                        <button 
                          className="btn-small btn-info"
                          onClick={() => handleEditProduct(product)}
                        >
                          <Edit size={14} style={{ marginLeft: '0.25rem', verticalAlign: 'middle' }} />
                          ערוך
                        </button>
                        <button 
                          className="btn-small btn-danger"
                          onClick={() => handleDeleteProduct(product.id)}
                          style={{ marginRight: '0.5rem' }}
                        >
                          <Trash2 size={14} style={{ marginLeft: '0.25rem', verticalAlign: 'middle' }} />
                          מחק
                        </button>
                        <button 
                          className="btn-small btn-secondary"
                          onClick={() => handleShowHistory(product)}
                          style={{ backgroundColor: '#6c757d', borderColor: '#6c757d', color: '#fff' }}
                        >
                          <History size={14} style={{ marginLeft: '0.25rem', verticalAlign: 'middle' }} />
                          הצג היסטוריה
                        </button>
                        <button
                          className="btn-small btn-secondary"
                          onClick={() => handleShowDeposits(product)}
                          style={{ backgroundColor: '#9C27B0', borderColor: '#9C27B0', color: '#fff', marginRight: '0.5rem' }}
                        >
                          <Wallet size={14} style={{ marginLeft: '0.25rem', verticalAlign: 'middle' }} />
                          פיקדונות
                        </button>
                        <button
                          className="btn-small btn-secondary"
                          onClick={() => handleShowAllocationReport(product)}
                          style={{ backgroundColor: '#1e88e5', borderColor: '#1e88e5', color: '#fff', marginRight: '0.5rem' }}
                        >
                          דוח חלוקה
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showAllocationModal && allocationReport && (
          <div className="modal" onClick={() => setShowAllocationModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '860px' }}>
              <div className="modal-header">
                <h2>דוח חלוקה - {allocationReport.product?.name}</h2>
                <button className="close-btn" onClick={() => setShowAllocationModal(false)}>×</button>
              </div>

              <div style={{ marginBottom: '1rem', color: '#666' }}>
                חוק: <strong>{allocationReport.ruleType}</strong> •
                כמות מקורית: <strong>{allocationReport.originalQuantity}</strong> •
                בסיס: <strong>{allocationReport.base}</strong> •
                שארית: <strong>{allocationReport.remainder}</strong>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>משתמש</th>
                    <th>מגיע לו</th>
                    <th>+1</th>
                    <th>לקח</th>
                    <th>העביר</th>
                    <th>קיבל</th>
                    <th>זמין</th>
                  </tr>
                </thead>
                <tbody>
                  {(allocationReport.rows || []).map((r) => (
                    <tr key={r.memberId}>
                      <td>{r.memberName}</td>
                      <td><strong>{r.entitlement}</strong></td>
                      <td>{r.extra ? 'כן' : ''}</td>
                      <td>{r.taken}</td>
                      <td>{r.transferredOut}</td>
                      <td>{r.received}</td>
                      <td><strong>{r.available}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAllocationModal(false)}>
                  סגור
                </button>
              </div>
            </div>
          </div>
        )}

        {showMemberModal && (
          <div className="modal" onClick={() => setShowMemberModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{editingMember ? 'ערוך חבר משפחה' : 'הוסף חבר משפחה'}</h2>
                <button className="close-btn" onClick={() => setShowMemberModal(false)}>×</button>
              </div>
              <form onSubmit={handleMemberSubmit}>
                <div className="form-group">
                  <label>שם:</label>
                  <input
                    type="text"
                    value={memberForm.name}
                    onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>גיל:</label>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="ageType"
                        checked={!memberForm.isChild}
                        onChange={() => setMemberForm({ ...memberForm, isChild: false })}
                      />
                      מבוגר
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="ageType"
                        checked={memberForm.isChild}
                        onChange={() => setMemberForm({ ...memberForm, isChild: true })}
                      />
                      ילד
                    </label>
                  </div>
                </div>
                <div className="form-group">
                  <label>מגדר:</label>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="gender"
                        value="male"
                        checked={memberForm.gender === 'male'}
                        onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value })}
                      />
                      זכר
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="gender"
                        value="female"
                        checked={memberForm.gender === 'female'}
                        onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value })}
                      />
                      נקבה
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="gender"
                        value="other"
                        checked={memberForm.gender === 'other'}
                        onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value })}
                      />
                      אחר
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="gender"
                        value=""
                        checked={memberForm.gender === ''}
                        onChange={(e) => setMemberForm({ ...memberForm, gender: '' })}
                      />
                      לא הוגדר
                    </label>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowMemberModal(false)}>
                    <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary">
                    <Save size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    שמור
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showProductModal && (
          <div className="modal" onClick={() => setShowProductModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>
                  {editingProduct ? (
                    <>
                      <Edit size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                      ערוך מוצר
                    </>
                  ) : (
                    <>
                      <PackagePlus size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                      הוסף מוצר
                    </>
                  )}
                </h2>
                <button className="close-btn" onClick={() => setShowProductModal(false)}>
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleProductSubmit}>
                <div className="form-group">
                  <label>שם מוצר:</label>
                  <input
                    type="text"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>כמות:</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={productForm.quantity}
                    onChange={(e) => setProductForm({ ...productForm, quantity: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>חוק חלוקה:</label>
                  <select
                    value={productForm.ruleType}
                    onChange={(e) => setProductForm({ ...productForm, ruleType: e.target.value })}
                    required
                  >
                    <option value="everyone">כולם</option>
                    <option value="children_only">ילדים בלבד</option>
                    <option value="adults_only">מבוגרים בלבד</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowProductModal(false)}>
                    <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary">
                    <Save size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    שמור
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showHistoryModal && selectedProductHistory && (
          <div className="modal" onClick={() => setShowHistoryModal(false)} style={{ 
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)'
          }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ 
              maxWidth: '700px', 
              maxHeight: '85vh', 
              overflowY: 'auto',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              border: 'none'
            }}>
              <div className="modal-header" style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1.5rem',
                borderRadius: '20px 20px 0 0',
                borderBottom: '2px solid rgba(255, 255, 255, 0.2)'
              }}>
                <h2 style={{ 
                  color: 'white', 
                  margin: 0,
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <History size={24} />
                  היסטוריית לקיחות - {selectedProductHistory.name}
                </h2>
                <button 
                  className="close-btn" 
                  onClick={() => setShowHistoryModal(false)} 
                  style={{
                    color: 'white',
                    fontSize: '1.5rem',
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '50%',
                    width: '35px',
                    height: '35px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                    e.currentTarget.style.transform = 'rotate(90deg) scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'rotate(0deg) scale(1)';
                  }}
                >
                  <X size={20} />
                </button>
              </div>
              <div style={{ padding: '1.5rem', background: 'white', minHeight: '300px' }}>
                {productTransactions.length === 0 ? (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '3rem',
                    color: '#999'
                  }}>
                    <AlertCircle size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                    <p style={{ fontSize: '1.2rem', margin: 0 }}>
                      אין היסטוריית לקיחות למוצר זה
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {productTransactions.map((item, index) => {
                      if (item.type === 'transaction') {
                        return (
                          <div 
                            key={`t-${item.id}`}
                            style={{
                              background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                              borderRadius: '15px',
                              padding: '1.25rem',
                              boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
                              border: '1px solid rgba(255, 255, 255, 0.5)',
                              transition: 'all 0.3s ease',
                              animation: `fadeIn 0.3s ease ${index * 0.1}s both`
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-3px)';
                              e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.15)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                  width: '45px',
                                  height: '45px',
                                  borderRadius: '50%',
                                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontSize: '1.2rem',
                                  fontWeight: 'bold',
                                  boxShadow: '0 4px 10px rgba(102, 126, 234, 0.3)'
                                }}>
                                  {item.member.isChild ? '👶' : '👤'}
                                </div>
                                <div>
                                  <div style={{ 
                                    fontWeight: 'bold', 
                                    fontSize: '1.1rem',
                                    color: '#333',
                                    marginBottom: '0.25rem'
                                  }}>
                                    {item.member.name}
                                  </div>
                                  <div style={{ 
                                    fontSize: '0.85rem', 
                                    color: '#666',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                  }}>
                                    <Clock size={14} />
                                    {formatDate(item.createdAt)}
                                  </div>
                                </div>
                              </div>
                              <div style={{
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                color: 'white',
                                padding: '0.5rem 1rem',
                                borderRadius: '20px',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                                boxShadow: '0 4px 10px rgba(102, 126, 234, 0.3)'
                              }}>
                                {item.quantity}{selectedProductHistory.unit ? ` ${selectedProductHistory.unit}` : ''}
                              </div>
                            </div>
                                  {item.notes && (
                              <div style={{
                                marginTop: '0.75rem',
                                padding: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.7)',
                                borderRadius: '10px',
                                fontSize: '0.9rem',
                                color: '#555',
                                borderRight: '4px solid #667eea',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}>
                                <FileText size={14} />
                                {item.notes}
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        return (
                          <div 
                            key={`tf-${item.id}`}
                            style={{
                              background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)',
                              borderRadius: '15px',
                              padding: '1.25rem',
                              boxShadow: '0 4px 15px rgba(255, 152, 0, 0.2)',
                              border: '1px solid rgba(255, 152, 0, 0.3)',
                              transition: 'all 0.3s ease',
                              animation: `fadeIn 0.3s ease ${index * 0.1}s both`
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-3px)';
                              e.currentTarget.style.boxShadow = '0 8px 25px rgba(255, 152, 0, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 152, 0, 0.2)';
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                  width: '45px',
                                  height: '45px',
                                  borderRadius: '50%',
                                  background: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontSize: '1.2rem',
                                  fontWeight: 'bold',
                                  boxShadow: '0 4px 10px rgba(255, 152, 0, 0.3)'
                                }}>
                                  🔄
                                </div>
                                <div>
                                  <div style={{ 
                                    fontWeight: 'bold', 
                                    fontSize: '1.1rem',
                                    color: '#333',
                                    marginBottom: '0.25rem'
                                  }}>
                                    {item.fromMember.name} → {item.toMember.name}
                                  </div>
                                  <div style={{ 
                                    fontSize: '0.85rem', 
                                    color: '#666',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                  }}>
                                    <Clock size={14} />
                                    {formatDate(item.createdAt)}
                                  </div>
                                </div>
                              </div>
                              <div style={{
                                background: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
                                color: 'white',
                                padding: '0.5rem 1rem',
                                borderRadius: '20px',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                                boxShadow: '0 4px 10px rgba(255, 152, 0, 0.3)'
                              }}>
                                {item.quantity}{selectedProductHistory.unit ? ` ${selectedProductHistory.unit}` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </div>
              <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                justifyContent: 'flex-end', 
                padding: '1.5rem',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '0 0 20px 20px',
                borderTop: '2px solid rgba(255, 255, 255, 0.2)'
              }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowHistoryModal(false)}
                  style={{
                    background: 'white',
                    color: '#667eea',
                    border: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: '25px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.2)';
                  }}
                >
                  <X size={18} />
                  סגור
                </button>
              </div>
            </div>
            <style>{`
              @keyframes fadeIn {
                from {
                  opacity: 0;
                  transform: translateY(10px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}</style>
          </div>
        )}

        {showDepositsModal && selectedProductDeposits && (
          <div className="modal" onClick={() => setShowDepositsModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
              <div className="modal-header">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Wallet size={22} />
                  פיקדונות - {selectedProductDeposits.name}
                </h2>
                <button className="close-btn" onClick={() => setShowDepositsModal(false)}>
                  <X size={24} />
                </button>
              </div>

              <div style={{ padding: '1rem 0.25rem 0.5rem 0.25rem' }}>
                {productDeposits.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
                    <AlertCircle size={44} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                    <div>אין פיקדונות למוצר זה</div>
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '0 1.5rem 1rem 1.5rem' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CheckCircle2 size={18} />
                        החזרת פיקדון
                      </div>

                      {productDeposits.filter(d => refundEligibleMemberIds.has(d.memberId)).length === 0 ? (
                        <div style={{ color: '#999', fontSize: '0.9rem' }}>
                          אין פיקדונות להחזרה.
                        </div>
                      ) : (
                        <select
                          value={refundSelectionMemberId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRefundSelectionMemberId(val);
                            if (val) handleRefundDeposit(val);
                          }}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #ddd' }}
                        >
                          <option value="">בחר משתמש להחזרת פיקדון</option>
                          {productDeposits
                            .filter(d => refundEligibleMemberIds.has(d.memberId))
                            .map(d => (
                              <option key={d.memberId} value={d.memberId}>
                                {d.member?.name || `משתמש ${d.memberId}`}
                              </option>
                            ))}
                        </select>
                      )}

                      {lastRefundedMemberName && (
                        <div style={{ marginTop: '0.75rem', color: '#2e7d32', fontWeight: 'bold' }}>
                          הפיקדון הוחזר ל: {lastRefundedMemberName}
                        </div>
                      )}
                    </div>

                    <div style={{ padding: '0 1.5rem 1rem 1.5rem', color: '#666' }}>
                      סה״כ פיקדונות: <strong style={{ color: '#333' }}>
                        {productDeposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0).toFixed(2)} ₪
                      </strong>
                    </div>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>משתמש</th>
                          <th>סכום</th>
                          <th>אמצעי תשלום</th>
                          <th>תאריך</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productDeposits.map((d) => (
                          <tr key={d.id}>
                            <td>{d.member?.name || '-'}</td>
                            <td><strong>{Number(d.amount || 0).toFixed(2)} ₪</strong></td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                {d.paymentMethod === 'cash' ? <Banknote size={16} /> : <CreditCard size={16} />}
                                {getPaymentLabel(d.paymentMethod)}
                              </span>
                            </td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Clock size={14} />
                                {formatDate(d.createdAt)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 1.5rem 1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowDepositsModal(false)}>
                  <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  סגור
                </button>
              </div>
            </div>
          </div>
        )}

        {showCredentialsModal && credentialsPayload && (
          <div className="modal" onClick={() => setShowCredentialsModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px' }}>
              <div className="modal-header">
                <h2>קודי כניסה - {credentialsPayload.name}</h2>
                <button className="close-btn" onClick={() => setShowCredentialsModal(false)}>×</button>
              </div>

              <div style={{ padding: '1rem 1.5rem' }}>
                <div style={{ color: '#666', marginBottom: '1rem' }}>
                  סרקו את ה־QR של ה־TOTP באפליקציית Authenticator. את ה־QR של מזהה הלקוח מציגים במסך התחברות במחשב.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  <div style={{ border: '1px solid #eee', borderRadius: '14px', padding: '1rem' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>QR מזהה לקוח</div>
                    {credentialsQr.client ? (
                      <img src={credentialsQr.client} alt="Client QR" style={{ width: '100%', maxWidth: '260px', display: 'block', margin: '0 auto' }} />
                    ) : (
                      <div style={{ textAlign: 'center', color: '#999' }}>טוען...</div>
                    )}
                    <div style={{ marginTop: '0.75rem', fontFamily: 'monospace', fontSize: '0.9rem', wordBreak: 'break-all' }}>
                      {credentialsPayload.clientCode}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #eee', borderRadius: '14px', padding: '1rem' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>QR TOTP (Authenticator)</div>
                    {credentialsQr.totp ? (
                      <img src={credentialsQr.totp} alt="TOTP QR" style={{ width: '100%', maxWidth: '260px', display: 'block', margin: '0 auto' }} />
                    ) : (
                      <div style={{ textAlign: 'center', color: '#999' }}>טוען...</div>
                    )}
                    <div style={{ marginTop: '0.75rem', color: '#666', fontSize: '0.9rem', wordBreak: 'break-all' }}>
                      {credentialsPayload.totpOtpauthUrl}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', padding: '0 1.5rem 1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCredentialsModal(false)}>
                  <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  סגור
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPanel;
