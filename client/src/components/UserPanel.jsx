import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { BrowserCodeReader, BrowserQRCodeReader } from '@zxing/browser';
import { 
  User, ShoppingCart, Package, Plus, X, Save, Clock, 
  ArrowRightLeft, Send, Check, XCircle, Wallet, CreditCard, 
  DollarSign, LogOut, Bell, Inbox, FileText, AlertCircle,
  UserCircle, RefreshCw, Trash2, Edit
} from 'lucide-react';
import './UserPanel.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function UserPanel() {
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [shareTransfers, setShareTransfers] = useState([]);
  const [shareRequests, setShareRequests] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [loginMembersView, setLoginMembersView] = useState(() => {
    try {
      const v = window.localStorage.getItem('loginMembersView');
      return v === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }); // 'grid' | 'list'
  const [loginStep, setLoginStep] = useState('choose'); // 'choose' | 'scan' | 'totp'
  const [loginMember, setLoginMember] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [transactionForm, setTransactionForm] = useState({ quantity: '', notes: '' });
  const [transferForm, setTransferForm] = useState({ quantity: '', toMemberId: '' });
  const [requestForm, setRequestForm] = useState({ quantity: '', toMemberId: '' });
  const [depositForm, setDepositForm] = useState({ 
    amount: '', 
    cardNumber: '', 
    cvv: '', 
    expiryDate: '', 
    idNumber: '',
    paymentMethod: 'card' // 'card' or 'cash'
  });
  const [loading, setLoading] = useState(true);
  const [refundToast, setRefundToast] = useState(null); // { message: string, products: string[] }

  useEffect(() => {
    fetchData();
  }, [selectedMember]);

  useEffect(() => {
    try {
      window.localStorage.setItem('loginMembersView', loginMembersView);
    } catch {
      // ignore
    }
  }, [loginMembersView]);

  const extractClientCodeFromQrText = (text) => {
    if (!text) return null;
    const raw = String(text).trim();
    if (raw.startsWith('otpauth://')) return null; // This is the Authenticator QR, not login QR

    try {
      const obj = JSON.parse(raw);
      const code = obj?.clientCode;
      if (typeof code === 'string' && code.trim()) return code.trim();
    } catch {
      // not JSON
    }

    // Fallback: allow scanning the UUID itself
    return raw;
  };

  useEffect(() => {
    if (loginStep !== 'scan') return;
    setScanError('');

    if (!loginMember?.clientCode) return;

    let isActive = true;
    const reader = new BrowserQRCodeReader();
    let controls = null;

    const start = async () => {
      try {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        // Prefer a back camera + higher resolution to improve QR decoding
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        };

        const onResult = (result, err) => {
          if (!isActive) return;
          if (result) {
            const scannedText = result.getText?.() || String(result);
            const scannedClientCode = extractClientCodeFromQrText(scannedText);
            if (!scannedClientCode) return;

            if (String(scannedClientCode) !== String(loginMember.clientCode)) {
              setScanError('ה־QR שנסרק לא תואם למשתמש שנבחר');
              return;
            }

            setScanError('');
            try {
              controls?.stop?.();
            } catch {
              // ignore
            }
            setLoginStep('totp');
            setAuthError('');
            setTotpCode('');
          } else if (err) {
            // Ignore decode errors (happens constantly while scanning)
          }
        };

        try {
          controls = await reader.decodeFromConstraints(constraints, videoEl, onResult);
        } catch (e1) {
          // Fallback: just pick any device
          const devices = await BrowserCodeReader.listVideoInputDevices();
          const deviceId = devices?.[0]?.deviceId || undefined;
          controls = await reader.decodeFromVideoDevice(deviceId, videoEl, onResult);
        }
      } catch (e) {
        console.error('Error starting QR scanner:', e);
        if (!isActive) return;
        setScanError('אין גישה למצלמה או שלא נמצאה מצלמה. ודאו שאישרתם הרשאה.');
      }
    };

    start();

    return () => {
      isActive = false;
      try {
        controls?.stop?.();
      } catch {
        // ignore
      }
      try {
        reader.reset?.();
      } catch {
        // ignore
      }
    };
  }, [loginStep, loginMember?.id, loginMember?.clientCode]);

  useEffect(() => {
    if (!selectedMember) return;
    
    const interval = setInterval(() => {
      fetchData();
    }, 5000); // Refresh every 5 seconds
    
    return () => clearInterval(interval);
  }, [selectedMember]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const promises = [
        axios.get(`${API_URL}/family-members`),
        axios.get(`${API_URL}/products`),
        axios.get(`${API_URL}/transactions`),
        axios.get(`${API_URL}/share-transfers`)
      ];
      
      // Always fetch requests and deposits if selectedMember exists
      if (selectedMember) {
        promises.push(axios.get(`${API_URL}/share-requests?memberId=${selectedMember.id}`));
        promises.push(axios.get(`${API_URL}/deposits?memberId=${selectedMember.id}`));
      } else {
        promises.push(Promise.resolve({ data: [] }));
        promises.push(Promise.resolve({ data: [] }));
      }
      
      const [membersRes, productsRes, transactionsRes, transfersRes, requestsRes, depositsRes] = await Promise.all(promises);
      setMembers(membersRes.data);
      setProducts(productsRes.data);
      setTransactions(transactionsRes.data);
      setShareTransfers(transfersRes.data);
      // Only update requests and deposits if we have selectedMember, otherwise keep existing
      if (selectedMember) {
        setShareRequests(requestsRes.data || []);
        setDeposits(depositsRes.data || []);

        // Fetch refund notifications (one-time) and show toast with confetti
        try {
          const refundEventsRes = await axios.get(`${API_URL}/refund-events?memberId=${selectedMember.id}`);
          const events = refundEventsRes.data || [];
          if (events.length > 0) {
            const productNames = [...new Set(events.map(e => e.productName).filter(Boolean))];
            setRefundToast({
              message: 'הפיקדון הוחזר בהצלחה',
              products: productNames
            });
            setTimeout(() => setRefundToast(null), 4000);
          }
        } catch (e) {
          // Silent: don't block main UI if notifications fail
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      // Don't clear requests on error, keep existing ones
      // Only show alert on initial load
      if (loading) {
        alert('שגיאה בטעינת הנתונים. אנא רענן את הדף.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpVerify = async (e) => {
    e.preventDefault();
    if (!loginMember) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const token = String(totpCode || '').replace(/\s/g, '');
      const res = await axios.post(`${API_URL}/auth/verify`, {
        memberId: loginMember.id,
        totp: token
      });
      setSelectedMember(res.data.member);
      setLoginStep('choose');
      setLoginMember(null);
      setTotpCode('');
    } catch (error) {
      console.error('Error verifying TOTP:', error);
      setAuthError(error.response?.data?.error || 'שגיאה בהתחברות');
    } finally {
      setAuthLoading(false);
    }
  };

  const Confetti = ({ active }) => {
    if (!active) return null;
    const pieces = Array.from({ length: 60 }, (_, i) => i);
    return (
      <>
        <div style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 9999
        }}>
          {pieces.map((i) => {
            const left = Math.random() * 100;
            const delay = Math.random() * 0.3;
            const duration = 1.8 + Math.random() * 0.7;
            const size = 6 + Math.floor(Math.random() * 6);
            const colors = ['#ff6b35', '#f7c59f', '#4caf50', '#2196f3', '#9c27b0', '#ffd166'];
            const color = colors[i % colors.length];
            const rotate = Math.random() * 360;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: '-10px',
                  left: `${left}%`,
                  width: `${size}px`,
                  height: `${size * 1.6}px`,
                  background: color,
                  borderRadius: '2px',
                  transform: `rotate(${rotate}deg)`,
                  animation: `confettiFall ${duration}s ease-out ${delay}s forwards`,
                  opacity: 0.95
                }}
              />
            );
          })}
        </div>
        <style>{`
          @keyframes confettiFall {
            0% { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
          }
        `}</style>
      </>
    );
  };

  const handleProductClick = (product) => {
    if (!selectedMember) {
      alert('אנא בחרו קודם את שמכם');
      return;
    }

    // Require deposit before taking a product
    if (getTotalDeposits(product.id) <= 0) {
      alert('חובה להפקיד פיקדון לפני שאפשר לקחת מוצר');
      return;
    }
    
    const totalAvailable = getTotalAvailable(product);
    if (totalAvailable <= 0) {
      alert('אין לך הקצבה זמינה מהמוצר הזה');
      return;
    }
    
    setSelectedProduct(product);
    const availableInt = Math.floor(totalAvailable);
    setTransactionForm({ quantity: availableInt > 0 ? availableInt.toString() : '', notes: '' });
    setShowTransactionModal(true);
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/transactions`, {
        productId: selectedProduct.id,
        memberId: selectedMember.id,
        quantity: parseInt(transactionForm.quantity),
        notes: transactionForm.notes
      });
      setShowTransactionModal(false);
      setSelectedProduct(null);
      setTransactionForm({ quantity: '', notes: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating transaction:', error);
      alert(error.response?.data?.error || 'שגיאה ביצירת העסקה');
    }
  };

  const getRuleLabel = (ruleType) => {
    const rules = {
      'everyone': 'כולם',
      'children_only': 'ילדים בלבד',
      'adults_only': 'מבוגרים בלבד',
      'specific_members': 'רשימה נבחרת'
    };
    return rules[ruleType] || ruleType;
  };

  const canTakeProduct = (product) => {
    if (!selectedMember) return false;
    const rule = product.rules && product.rules[0];
    if (!rule) return true;
    
    if (rule.ruleType === 'children_only' && !selectedMember.isChild) return false;
    if (rule.ruleType === 'adults_only' && selectedMember.isChild) return false;
    return true;
  };

  const isMemberEligibleForProduct = (product, member) => {
    const rule = product?.rules && product.rules[0];
    if (!rule || rule.ruleType === 'everyone') return true;
    if (rule.ruleType === 'specific_members') {
      const ids = Array.isArray(rule.specificMemberIds) ? rule.specificMemberIds : [];
      return ids.includes(member?.id);
    }
    if (rule.ruleType === 'children_only') return !!member?.isChild;
    if (rule.ruleType === 'adults_only') return !member?.isChild;
    return true;
  };

  const getEligibleMembersForProduct = (product) => {
    const rule = product?.rules && product.rules[0];
    if (!rule || rule.ruleType === 'everyone') return members;
    if (rule.ruleType === 'specific_members') {
      const ids = Array.isArray(rule.specificMemberIds) ? rule.specificMemberIds : [];
      const set = new Set(ids);
      return members.filter((m) => set.has(m.id));
    }
    if (rule.ruleType === 'children_only') return members.filter(m => m.isChild);
    if (rule.ruleType === 'adults_only') return members.filter(m => !m.isChild);
    return members;
  };

  const getEntitlementForMember = (product, memberId) => {
    const eligible = getEligibleMembersForProduct(product);
    const count = eligible.length;
    if (!count) return 0;

    const originalQuantity = getOriginalQuantity(product);
    const base = Math.floor(originalQuantity / count);
    const remainder = ((originalQuantity % count) + count) % count;
    if (remainder === 0) return base;

    const sorted = [...eligible].sort((a, b) => a.id - b.id);
    const idx = sorted.findIndex(m => m.id === memberId);
    if (idx < 0) return 0;

    const offset = ((Number(product?.extraOffset || 0) % count) + count) % count;
    const relative = (idx - offset + count) % count;
    const extra = relative < remainder ? 1 : 0;
    return base + extra;
  };

  // Calculate original quantity (current quantity + all transactions for this product)
  const getOriginalQuantity = (product) => {
    const productTransactions = transactions.filter(t => t.productId === product.id);
    const totalTaken = productTransactions.reduce((sum, t) => sum + t.quantity, 0);
    return product.quantity + totalTaken; // Current + all taken = original
  };

  // Calculate fair share for a product
  const calculateFairShare = (product) => {
    if (!selectedMember) return 0;
    return getEntitlementForMember(product, selectedMember.id);
  };

  // Calculate how much the selected member has already taken from a product
  const getTakenAmount = (productId) => {
    if (!selectedMember) return 0;
    
    const memberTransactions = transactions.filter(
      t => t.memberId === selectedMember.id && t.productId === productId
    );
    
    const totalTaken = memberTransactions.reduce((sum, t) => sum + t.quantity, 0);
    return Math.floor(totalTaken);
  };

  // Calculate how much the selected member has transferred from a product
  const getTransferredAmount = (productId) => {
    if (!selectedMember) return 0;
    
    const memberTransfers = shareTransfers.filter(
      t => t.fromMemberId === selectedMember.id && t.productId === productId
    );
    
    const totalTransferred = memberTransfers.reduce((sum, t) => sum + t.quantity, 0);
    return Math.floor(totalTransferred);
  };

  // Calculate how much the selected member has received from transfers
  const getReceivedAmount = (productId) => {
    if (!selectedMember) return 0;
    
    const memberReceived = shareTransfers.filter(
      t => t.toMemberId === selectedMember.id && t.productId === productId
    );
    
    const totalReceived = memberReceived.reduce((sum, t) => sum + t.quantity, 0);
    return Math.floor(totalReceived);
  };

  // Calculate remaining fair share (fair share - already taken - already transferred)
  // This is what's left from YOUR original allocation (not including what you received)
  // Note: Deposits don't affect allocation - they're just prepayments
  const getRemainingFairShare = (product) => {
    const fairShare = selectedMember ? getEntitlementForMember(product, selectedMember.id) : 0;
    const taken = getTakenAmount(product.id);
    const transferred = getTransferredAmount(product.id);
    // Remaining = fair share - taken - transferred (NOT including deposits or received)
    const remaining = fairShare - taken - transferred;
    return Math.max(0, Math.floor(remaining)); // Don't allow negative, return integer only
  };

  // Calculate total available (remaining from your allocation + received transfers)
  const getTotalAvailable = (product) => {
    const remainingFromAllocation = getRemainingFairShare(product);
    const received = getReceivedAmount(product.id);
    // Total = what's left from your allocation + what you received from others
    return remainingFromAllocation + received;
  };

  // Calculate total deposits for a product (for display only, not for allocation calculation)
  // Deposits are prepayments and don't affect the allocation
  const getTotalDeposits = (productId) => {
    if (!selectedMember) return 0;
    const memberDeposits = deposits.filter(
      d => d.memberId === selectedMember.id && d.productId === productId
    );
    return memberDeposits.reduce((sum, d) => sum + d.amount, 0);
  };

  const handleDepositClick = (product) => {
    if (!selectedMember) {
      alert('אנא בחרו קודם את שמכם');
      return;
    }

    // Deposits are locked: prevent re-depositing to avoid changing amount
    if (getTotalDeposits(product.id) > 0) {
      alert('כבר הפקדת פיקדון למוצר הזה — לא ניתן לשנות את סכום הפיקדון');
      return;
    }
    
    setSelectedProduct(product);
    setDepositForm({ 
      amount: '50', 
      cardNumber: '', 
      cvv: '', 
      expiryDate: '', 
      idNumber: '',
      paymentMethod: 'card'
    });
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    try {
      // Validate amount
      const amount = parseFloat(depositForm.amount);
      if (amount < 50 || amount > 1000) {
        alert('הסכום חייב להיות בין 50 ₪ ל-1000 ₪');
        return;
      }

      // If cash payment, don't require card details
      const depositData = {
        productId: selectedProduct.id,
        memberId: selectedMember.id,
        amount: amount,
        paymentMethod: depositForm.paymentMethod
      };

      // Only include card details if payment method is card
      if (depositForm.paymentMethod === 'card') {
        depositData.cardNumber = depositForm.cardNumber;
        depositData.cvv = depositForm.cvv;
        depositData.expiryDate = depositForm.expiryDate;
        depositData.idNumber = depositForm.idNumber;
      }

      await axios.post(`${API_URL}/deposits`, depositData);
      setShowDepositModal(false);
      setSelectedProduct(null);
      setDepositForm({ amount: '', cardNumber: '', cvv: '', expiryDate: '', idNumber: '', paymentMethod: 'card' });
      fetchData();
    } catch (error) {
      console.error('Error creating deposit:', error);
      alert(error.response?.data?.error || 'שגיאה ביצירת הפיקדון');
    }
  };

  const handleCancelDeposit = async (depositId) => {
    alert('לא ניתן לבטל פיקדון לאחר שהופקד');
  };

  const handleTransferClick = (product) => {
    if (!selectedMember) {
      alert('אנא בחרו קודם את שמכם');
      return;
    }
    
    const remaining = getRemainingFairShare(product);
    if (remaining <= 0) {
      alert('אין לך הקצבה להעביר מהמוצר הזה (ההקצבה שלך כבר נלקחה או הועברה)');
      return;
    }
    
    setSelectedProduct(product);
    setTransferForm({ quantity: remaining > 0 ? remaining.toString() : '', toMemberId: '' });
    setShowTransferModal(true);
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    try {
      const toMember = members.find(m => m.id === parseInt(transferForm.toMemberId));
      if (toMember && !isMemberEligibleForProduct(selectedProduct, toMember)) {
        alert('לפי חוק החלוקה של המוצר, אי אפשר להעביר הקצבה למשתמש הזה');
        return;
      }
      await axios.post(`${API_URL}/share-transfers`, {
        productId: selectedProduct.id,
        fromMemberId: selectedMember.id,
        toMemberId: parseInt(transferForm.toMemberId),
        quantity: parseInt(transferForm.quantity)
      });
      setShowTransferModal(false);
      setSelectedProduct(null);
      setTransferForm({ quantity: '', toMemberId: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating transfer:', error);
      alert(error.response?.data?.error || 'שגיאה בהעברת הקצבה');
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

  // Calculate remaining fair share for a specific member (for checking if they have available share)
  const getMemberRemainingFairShare = (product, memberId) => {
    const fairShare = getEntitlementForMember(product, memberId);
    
    const memberTransactions = transactions.filter(
      t => t.memberId === memberId && t.productId === product.id
    );
    const totalTaken = memberTransactions.reduce((sum, t) => sum + t.quantity, 0);
    
    const memberTransfers = shareTransfers.filter(
      t => t.fromMemberId === memberId && t.productId === product.id
    );
    const totalTransferred = memberTransfers.reduce((sum, t) => sum + t.quantity, 0);
    
    const remaining = fairShare - totalTaken - totalTransferred;
    return Math.max(0, Math.floor(remaining));
  };

  const handleRequestClick = (product) => {
    if (!selectedMember) {
      alert('אנא בחרו קודם את שמכם');
      return;
    }
    
    setSelectedProduct(product);
    setRequestForm({ quantity: '1', toMemberId: '' });
    setShowRequestModal(true);
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    try {
      const toMember = members.find(m => m.id === parseInt(requestForm.toMemberId));
      if (toMember && !isMemberEligibleForProduct(selectedProduct, toMember)) {
        alert('לפי חוק החלוקה של המוצר, אי אפשר לבקש הקצבה מהמשתמש הזה');
        return;
      }
      await axios.post(`${API_URL}/share-requests`, {
        productId: selectedProduct.id,
        fromMemberId: selectedMember.id,
        toMemberId: parseInt(requestForm.toMemberId),
        quantity: parseInt(requestForm.quantity)
      });
      setShowRequestModal(false);
      setSelectedProduct(null);
      setRequestForm({ quantity: '', toMemberId: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating request:', error);
      alert(error.response?.data?.error || 'שגיאה בבקשת הקצבה');
    }
  };

  const handleApproveRequest = async (requestId) => {
    try {
      await axios.put(`${API_URL}/share-requests/${requestId}/approve`);
      fetchData();
    } catch (error) {
      console.error('Error approving request:', error);
      alert(error.response?.data?.error || 'שגיאה באישור הבקשה');
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await axios.put(`${API_URL}/share-requests/${requestId}/reject`);
      fetchData();
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert(error.response?.data?.error || 'שגיאה בדחיית הבקשה');
    }
  };

  const handleCancelRequest = async (requestId) => {
    if (!window.confirm('האם אתה בטוח שברצונך לבטל את הבקשה?')) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/share-requests/${requestId}`);
      fetchData();
    } catch (error) {
      console.error('Error cancelling request:', error);
      alert(error.response?.data?.error || 'שגיאה בביטול הבקשה');
    }
  };

  const handleCancelTransaction = async (transactionId) => {
    if (!window.confirm('האם אתה בטוח שברצונך לבטל את לקיחת המוצר? הכמות תוחזר למלאי.')) {
      return;
    }
    try {
      await axios.delete(`${API_URL}/transactions/${transactionId}`);
      fetchData();
    } catch (error) {
      console.error('Error cancelling transaction:', error);
      alert(error.response?.data?.error || 'שגיאה בביטול לקיחת המוצר');
    }
  };

  // Get pending requests sent to me
  const getPendingRequestsToMe = () => {
    if (!selectedMember || !shareRequests || shareRequests.length === 0) return [];
    return shareRequests.filter(
      r => r && r.toMemberId === selectedMember.id && r.status === 'pending'
    );
  };

  // Get my pending requests
  const getMyPendingRequests = () => {
    if (!selectedMember || !shareRequests || shareRequests.length === 0) return [];
    return shareRequests.filter(
      r => r && r.fromMemberId === selectedMember.id && r.status === 'pending'
    );
  };

  return (
    <div className="user-panel">
      <Confetti active={!!refundToast} />
      {refundToast && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          background: 'white',
          border: '2px solid #4CAF50',
          borderRadius: '14px',
          padding: '0.9rem 1.2rem',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          minWidth: '280px',
          textAlign: 'center',
          animation: 'toastPop 0.25s ease-out'
        }}>
          <div style={{ fontWeight: 'bold', color: '#2e7d32', fontSize: '1.05rem' }}>
            {refundToast.message}
          </div>
          {refundToast.products?.length > 0 && (
            <div style={{ marginTop: '0.25rem', color: '#666', fontSize: '0.9rem' }}>
              עבור: {refundToast.products.join(' ,')}
            </div>
          )}
          <style>{`
            @keyframes toastPop {
              from { transform: translateX(-50%) translateY(-10px); opacity: 0; }
              to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
      <div className="container">
        <h1 className="page-title">
          <User size={28} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
          ממשק משתמש
        </h1>

        {!selectedMember && loginStep === 'choose' && (
          <div className="card member-selector">
            <h2 className="card-title">התחברות</h2>
            <div style={{ color: '#666', marginBottom: '0.75rem' }}>
              בחרו משתמש, סרקו עם המצלמה את ה־QR שהמשתמש מציג, ולאחר מכן הזינו קוד מאפליקציית Authenticator.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn-small btn-secondary"
                onClick={() => setLoginMembersView('grid')}
                style={{
                  background: loginMembersView === 'grid' ? '#667eea' : 'white',
                  borderColor: '#667eea',
                  color: loginMembersView === 'grid' ? '#fff' : '#667eea'
                }}
              >
                GRID
              </button>
              <button
                type="button"
                className="btn-small btn-secondary"
                onClick={() => setLoginMembersView('list')}
                style={{
                  background: loginMembersView === 'list' ? '#667eea' : 'white',
                  borderColor: '#667eea',
                  color: loginMembersView === 'list' ? '#fff' : '#667eea'
                }}
              >
                רשימה
              </button>
            </div>
            {loading ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
                טוען...
              </p>
            ) : members.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
                אין משתמשים במערכת. אנא הוסף משתמשים בממשק הניהול.
              </p>
            ) : (
              <div className={`member-grid ${loginMembersView === 'list' ? 'member-list' : ''}`}>
                {members.map(member => (
                  <button
                    key={member.id}
                    className={`member-card ${loginMembersView === 'list' ? 'member-card-list' : ''}`}
                    onClick={() => {
                      setLoginMember(member);
                      setLoginStep('scan');
                      setAuthError('');
                      setTotpCode('');
                      setScanError('');
                    }}
                  >
                    <div className="member-icon">{member.isChild ? '👶' : '👤'}</div>
                    <div className="member-name">{member.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedMember && loginStep === 'scan' && loginMember && (
          <div className="card member-selector" style={{ maxWidth: '720px', margin: '0 auto' }}>
            <h2 className="card-title">סריקת QR כניסה - {loginMember.name}</h2>
            <div style={{ color: '#666', marginBottom: '1rem' }}>
              הפעילו מצלמה וסרקו את ה־QR שהמשתמש מציג (מזהה לקוח).
            </div>

            {!loginMember.clientCode ? (
              <div style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #ffcdd2', background: '#ffebee', color: '#c62828' }}>
                למשתמש הזה אין קודי כניסה. פנו לממשק הניהול ולחצו “קודי כניסה”.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '100%', maxWidth: '520px' }}>
                    <video
                      ref={videoRef}
                      style={{
                        width: '100%',
                        borderRadius: '14px',
                        border: '1px solid #eee',
                        background: '#111'
                      }}
                      muted
                      playsInline
                    />
                  </div>
                </div>

                {scanError && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '12px', border: '1px solid #ffcdd2', background: '#ffebee', color: '#c62828' }}>
                    {scanError}
                  </div>
                )}

                <div style={{ marginTop: '0.75rem', color: '#666', fontSize: '0.9rem' }}>
                  טיפ לזיהוי: הגדילו את ה־QR על המסך, העלו בהירות למסך המציג, והרחיקו/קרבו עד שהמצלמה בפוקוס.
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setLoginStep('choose');
                  setLoginMember(null);
                  setAuthError('');
                  setTotpCode('');
                  setScanError('');
                }}
              >
                חזור
              </button>
            </div>
          </div>
        )}

        {!selectedMember && loginStep === 'totp' && loginMember && (
          <div className="card member-selector" style={{ maxWidth: '520px', margin: '0 auto' }}>
            <h2 className="card-title">הזנת קוד TOTP - {loginMember.name}</h2>
            <div style={{ color: '#666', marginBottom: '1rem' }}>
              פתחו את אפליקציית ה־Authenticator והקלידו את הקוד (6 ספרות).
            </div>

            <form onSubmit={handleTotpVerify}>
              <div className="form-group">
                <label>קוד:</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>

              {authError && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '12px', border: '1px solid #ffcdd2', background: '#ffebee', color: '#c62828' }}>
                  {authError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setLoginStep('scan');
                    setAuthError('');
                    setTotpCode('');
                  }}
                >
                  חזור
                </button>
                <button type="submit" className="btn btn-primary" disabled={authLoading || totpCode.length !== 6}>
                  {authLoading ? 'מתחבר...' : 'התחבר'}
                </button>
              </div>
            </form>
          </div>
        )}

        {selectedMember && (
          <>
            <div className="card welcome-card">
              <div className="welcome-content">
                <h2>
                  <UserCircle size={24} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  שלום {selectedMember.name}!
                </h2>
                <button 
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedMember(null);
                    setLoginStep('choose');
                    setLoginMember(null);
                    setAuthError('');
                    setTotpCode('');
                    setScanError('');
                  }}
                >
                  <LogOut size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  החלף משתמש
                </button>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">📦 המלאי הזמין</h2>
              {products.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
                  אין מוצרים במלאי
                </p>
              ) : (
                <div className="products-grid">
                  {products.map(product => {
                    const rule = product.rules && product.rules[0];
                    const canTake = canTakeProduct(product);
                    const isAvailable = product.quantity > 0;
                    const remaining = getRemainingFairShare(product);
                    const totalAvailable = getTotalAvailable(product);
                    const hasRemaining = totalAvailable > 0;
                    const hasDeposit = getTotalDeposits(product.id) > 0;
                    
                    return (
                      <div
                        key={product.id}
                        className={`product-card ${!canTake || !isAvailable || !hasRemaining ? 'disabled' : ''}`}
                      >
                        <div className="product-header">
                          <h3>{product.name}</h3>
                          {!canTake && (
                            <span className="badge badge-warning">
                              {getRuleLabel(rule ? rule.ruleType : 'everyone')}
                            </span>
                          )}
                        </div>
                        <div className="product-info">
                          <p className="product-quantity">
                            <strong>כמות:</strong> {product.quantity}{product.unit ? ` ${product.unit}` : ''}
                          </p>
                          {canTake && isAvailable && (
                            <>
                              <p className="product-fair-share" style={{ 
                                color: hasRemaining ? '#4CAF50' : '#f44336', 
                                fontWeight: 'bold',
                                marginTop: '0.5rem',
                                fontSize: '0.95rem'
                              }}>
                                {hasRemaining ? (
                                  <>זמין לך: {totalAvailable}{product.unit ? ` ${product.unit}` : ''}</>
                                ) : (
                                  <>לקחת את כל ההקצבה שלך</>
                                )}
                              </p>
                              {getTakenAmount(product.id) > 0 && (
                                <p style={{ 
                                  color: '#666', 
                                  fontSize: '0.85rem',
                                  marginTop: '0.25rem'
                                }}>
                                  כבר לקחת: {getTakenAmount(product.id)}{product.unit ? ` ${product.unit}` : ''}
                                </p>
                              )}
                              {getTransferredAmount(product.id) > 0 && (
                                <p style={{ 
                                  color: '#ff9800', 
                                  fontSize: '0.85rem',
                                  marginTop: '0.25rem'
                                }}>
                                  העברת: {getTransferredAmount(product.id)}{product.unit ? ` ${product.unit}` : ''}
                                </p>
                              )}
                              {getReceivedAmount(product.id) > 0 && (
                                <p style={{ 
                                  color: '#2196F3', 
                                  fontSize: '0.85rem',
                                  marginTop: '0.25rem'
                                }}>
                                  קיבלת: {getReceivedAmount(product.id)}{product.unit ? ` ${product.unit}` : ''}
                                </p>
                              )}
                              {getTotalDeposits(product.id) > 0 && (
                                <p style={{ 
                                  color: '#9C27B0', 
                                  fontSize: '0.85rem',
                                  marginTop: '0.25rem',
                                  fontWeight: 'bold'
                                }}>
                                  💰 הפקדת: {getTotalDeposits(product.id).toFixed(2)} ₪
                                </p>
                              )}
                            </>
                          )}
                          {rule && canTake && (
                            <p className="product-rule">
                              <small>חוק: {getRuleLabel(rule.ruleType)}</small>
                            </p>
                          )}
                        </div>
                        {isAvailable && canTake && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            {hasRemaining && hasDeposit && (
                              <button 
                                className="btn-take"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleProductClick(product);
                                }}
                                style={{ flex: 1, minWidth: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                              >
                                <ShoppingCart size={16} />
                                קח מוצר
                              </button>
                            )}
                            {hasRemaining && !hasDeposit && (
                              <div style={{ flex: 1, minWidth: '100px', color: '#9C27B0', fontSize: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.6rem', borderRadius: '10px', border: '1px solid rgba(156,39,176,0.35)', background: 'rgba(156,39,176,0.06)' }}>
                                <Wallet size={16} style={{ marginLeft: '0.5rem' }} />
                                נדרש פיקדון כדי לקחת
                              </div>
                            )}
                            {getRemainingFairShare(product) > 0 && (
                              <button 
                                className="btn-take"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTransferClick(product);
                                }}
                                style={{ 
                                  flex: 1,
                                  minWidth: '100px',
                                  background: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
                                  border: 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.5rem'
                                }}
                              >
                                <ArrowRightLeft size={16} />
                                העבר הקצבה
                              </button>
                            )}
                            <button 
                              className="btn-take"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestClick(product);
                              }}
                              style={{ 
                                flex: 1,
                                minWidth: '100px',
                                background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              <Send size={16} />
                              בקש הקצבה
                            </button>
                            <button 
                              className="btn-take"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDepositClick(product);
                              }}
                              style={{ 
                                flex: 1,
                                minWidth: '100px',
                                background: 'linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              <Wallet size={16} />
                              הפקד פיקדון
                            </button>
                          </div>
                        )}
                        {isAvailable && canTake && !hasRemaining && (
                          <p className="out-of-stock" style={{ color: '#f44336' }}>לקחת את כל ההקצבה</p>
                        )}
                        {!isAvailable && (
                          <p className="out-of-stock">אזל מהמלאי</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {getPendingRequestsToMe().length > 0 && (
              <div className="card" style={{ background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', border: '2px solid #ff9800' }}>
                <h2 className="card-title">🔔 בקשות ממתינות לאישור</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {getPendingRequestsToMe().map(request => (
                    <div key={request.id} style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '10px',
                      border: '1px solid #ff9800',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                          {request.fromMember.name} מבקש {request.quantity}{request.product.unit ? ` ${request.product.unit}` : ''} של {request.product.name}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Clock size={14} />
                          {formatDate(request.createdAt)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="btn-take"
                          onClick={() => handleApproveRequest(request.id)}
                          style={{
                            background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
                            border: 'none',
                            padding: '0.5rem 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}
                        >
                          <Check size={16} />
                          אישר
                        </button>
                        <button
                          className="btn-take"
                          onClick={() => handleRejectRequest(request.id)}
                          style={{
                            background: 'linear-gradient(135deg, #f44336 0%, #da190b 100%)',
                            border: 'none',
                            padding: '0.5rem 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}
                        >
                          <XCircle size={16} />
                          דחה
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {getMyPendingRequests().length > 0 && (
              <div className="card" style={{ background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)', border: '2px solid #2196F3' }}>
                <h2 className="card-title">
                  <Inbox size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  הבקשות שלי
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {getMyPendingRequests().map(request => (
                    <div key={request.id} style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '10px',
                      border: '1px solid #2196F3',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                          ביקשת {request.quantity}{request.product.unit ? ` ${request.product.unit}` : ''} של {request.product.name} מ-{request.toMember.name}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Clock size={14} />
                          {formatDate(request.createdAt)} • ממתין לאישור
                        </div>
                      </div>
                      <button
                        className="btn-take"
                        onClick={() => handleCancelRequest(request.id)}
                        style={{
                          background: 'linear-gradient(135deg, #f44336 0%, #da190b 100%)',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                      >
                        <X size={16} />
                        בטל בקשה
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deposits.filter(d => d.memberId === selectedMember?.id).length > 0 && (
              <div className="card" style={{ background: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)', border: '2px solid #9C27B0' }}>
                <h2 className="card-title">
                  <Wallet size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  הפיקדונות שלי
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                  {deposits
                    .filter(d => d.memberId === selectedMember.id)
                    .map(deposit => (
                      <div key={deposit.id} style={{
                        background: 'white',
                        padding: '1rem',
                        borderRadius: '10px',
                        border: '1px solid #9C27B0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                            פיקדון: {deposit.amount} ₪ עבור {deposit.product.name}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Clock size={14} />
                            {formatDate(deposit.createdAt)} • {deposit.paymentMethod === 'cash' ? (
                              <>
                                <DollarSign size={14} />
                                מזומן
                              </>
                            ) : (
                              <>
                                <CreditCard size={14} />
                                כרטיס אשראי
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="card">
              <h2 className="card-title">
                <FileText size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                לוג פעילות
              </h2>
              {transactions.length === 0 && shareTransfers.length === 0 && deposits.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
                  אין פעילות עדיין
                </p>
              ) : (
                <div className="transactions-list">
                  {[...transactions.map(t => ({ ...t, type: 'transaction', sortDate: new Date(t.createdAt) })), 
                     ...shareTransfers.map(t => ({ ...t, type: 'transfer', sortDate: new Date(t.createdAt) })),
                     ...deposits.map(d => ({ ...d, type: 'deposit', sortDate: new Date(d.createdAt) }))]
                    .sort((a, b) => b.sortDate - a.sortDate)
                    .map(item => {
                      if (item.type === 'transaction') {
                        const isMyTransaction = selectedMember && item.memberId === selectedMember.id;
                        return (
                          <div key={`t-${item.id}`} className="log-item" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div className="log-item-header">
                                <span className="log-item-name">
                                  {item.member.name} לקח {item.product.name}
                                </span>
                                <span className="log-item-time">
                                  {formatDate(item.createdAt)}
                                </span>
                              </div>
                              <div className="log-item-details">
                                כמות: {item.quantity}{item.product.unit ? ` ${item.product.unit}` : ''}
                                {item.notes && ` • הערה: ${item.notes}`}
                              </div>
                            </div>
                            {isMyTransaction && (
                              <button
                                className="btn-take"
                                onClick={() => handleCancelTransaction(item.id)}
                                style={{
                                  background: 'linear-gradient(135deg, #f44336 0%, #da190b 100%)',
                                  border: 'none',
                                  padding: '0.5rem 1rem',
                                  whiteSpace: 'nowrap',
                                  marginLeft: '1rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem'
                                }}
                              >
                                <X size={16} />
                                בטל
                              </button>
                            )}
                          </div>
                        );
                      } else if (item.type === 'deposit') {
                        const isMyDeposit = selectedMember && item.memberId === selectedMember.id;
                        return (
                          <div key={`d-${item.id}`} className="log-item" style={{
                            borderRight: '4px solid #9C27B0',
                            background: 'linear-gradient(90deg, rgba(156, 39, 176, 0.1) 0%, transparent 100%)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div className="log-item-header">
                                <span className="log-item-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <Wallet size={16} />
                                  {item.member.name} הפקיד פיקדון עבור {item.product.name}
                                </span>
                                <span className="log-item-time">
                                  {formatDate(item.createdAt)}
                                </span>
                              </div>
                              <div className="log-item-details" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                סכום: {item.amount} ₪ • {item.paymentMethod === 'cash' ? (
                                  <>
                                    <DollarSign size={14} />
                                    מזומן
                                  </>
                                ) : (
                                  <>
                                    <CreditCard size={14} />
                                    כרטיס אשראי
                                  </>
                                )}
                              </div>
                            </div>
                            {isMyDeposit && null}
                          </div>
                        );
                      } else {
                        return (
                          <div key={`tf-${item.id}`} className="log-item" style={{
                            borderRight: '4px solid #ff9800',
                            background: 'linear-gradient(90deg, rgba(255, 152, 0, 0.1) 0%, transparent 100%)'
                          }}>
                            <div className="log-item-header">
                              <span className="log-item-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <ArrowRightLeft size={16} />
                                {item.fromMember.name} העביר ל-{item.toMember.name} - {item.product.name}
                              </span>
                              <span className="log-item-time">
                                {formatDate(item.createdAt)}
                              </span>
                            </div>
                            <div className="log-item-details">
                              כמות: {item.quantity}{item.product.unit ? ` ${item.product.unit}` : ''}
                            </div>
                          </div>
                        );
                      }
                    })}
                </div>
              )}
            </div>
          </>
        )}

        {showTransactionModal && selectedProduct && (
          <div className="modal" onClick={() => setShowTransactionModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>
                  <ShoppingCart size={22} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                  קח {selectedProduct.name}
                </h2>
                <button className="close-btn" onClick={() => setShowTransactionModal(false)}>
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleTransactionSubmit}>
                <div className="form-group">
                  <label>כמות (זמין: {selectedProduct.quantity}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}):</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max={Math.floor(getTotalAvailable(selectedProduct))}
                      value={transactionForm.quantity}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 0;
                        const maxAllowed = Math.floor(getTotalAvailable(selectedProduct));
                        if (value > maxAllowed) {
                          setTransactionForm({ ...transactionForm, quantity: maxAllowed.toString() });
                        } else if (value < 1) {
                          setTransactionForm({ ...transactionForm, quantity: '1' });
                        } else {
                          setTransactionForm({ ...transactionForm, quantity: e.target.value });
                        }
                      }}
                      required
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        const available = Math.floor(getTotalAvailable(selectedProduct));
                        if (available > 0) {
                          setTransactionForm({ ...transactionForm, quantity: available.toString() });
                        }
                      }}
                      style={{ whiteSpace: 'nowrap', fontSize: '0.9rem', padding: '0.5rem 1rem' }}
                    >
                      החלק שלי
                    </button>
                  </div>
                  <small style={{ color: '#666', marginTop: '0.25rem', display: 'block' }}>
                    החלק היחסי שלך: {calculateFairShare(selectedProduct)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}
                    {getTakenAmount(selectedProduct.id) > 0 && (
                      <> • כבר לקחת: {getTakenAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getTransferredAmount(selectedProduct.id) > 0 && (
                      <> • העברת: {getTransferredAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getReceivedAmount(selectedProduct.id) > 0 && (
                      <> • קיבלת: {getReceivedAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getTotalAvailable(selectedProduct) > 0 && (
                      <> • זמין לך: {getTotalAvailable(selectedProduct)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                  </small>
                </div>
                <div className="form-group">
                  <label>הערה (אופציונלי):</label>
                  <input
                    type="text"
                    value={transactionForm.notes}
                    onChange={(e) => setTransactionForm({ ...transactionForm, notes: e.target.value })}
                    placeholder="למשל: לקחתי לארוחת בוקר"
                  />
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowTransactionModal(false)}>
                    <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary">
                    <Check size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    אישור
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showTransferModal && selectedProduct && (
          <div className="modal" onClick={() => setShowTransferModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
              background: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}>
              <div className="modal-header" style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1.5rem',
                borderRadius: '20px 20px 0 0',
                borderBottom: '2px solid rgba(255, 255, 255, 0.2)'
              }}>
                <h2 style={{ color: 'white', margin: 0, fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowRightLeft size={24} />
                  העברת הקצבה - {selectedProduct.name}
                </h2>
                <button className="close-btn" onClick={() => setShowTransferModal(false)} style={{
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
                }}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleTransferSubmit} style={{ padding: '1.5rem', background: 'white' }}>
                <div className="form-group">
                  <label>כמות להעברה (נשאר מההקצבה שלך: {getRemainingFairShare(selectedProduct)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}):</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max={getRemainingFairShare(selectedProduct)}
                    value={transferForm.quantity}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      const maxAllowed = Math.floor(getRemainingFairShare(selectedProduct));
                      if (value > maxAllowed) {
                        setTransferForm({ ...transferForm, quantity: maxAllowed.toString() });
                      } else if (value < 1) {
                        setTransferForm({ ...transferForm, quantity: '1' });
                      } else {
                        setTransferForm({ ...transferForm, quantity: e.target.value });
                      }
                    }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>העבר ל:</label>
                  <select
                    value={transferForm.toMemberId}
                    onChange={(e) => setTransferForm({ ...transferForm, toMemberId: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                  >
                    <option value="">בחר משתמש</option>
                    {members
                      .filter(m => m.id !== selectedMember.id && isMemberEligibleForProduct(selectedProduct, m))
                      .map(member => (
                        <option key={member.id} value={member.id}>
                          {member.name} {member.isChild ? '(ילד)' : '(מבוגר)'}
                        </option>
                      ))}
                  </select>
                </div>
                  <small style={{ color: '#666', marginTop: '0.25rem', display: 'block' }}>
                    הקצבה שלך: {calculateFairShare(selectedProduct)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}
                    {getTakenAmount(selectedProduct.id) > 0 && (
                      <> • כבר לקחת: {getTakenAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getTransferredAmount(selectedProduct.id) > 0 && (
                      <> • כבר העברת: {getTransferredAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getReceivedAmount(selectedProduct.id) > 0 && (
                      <> • קיבלת: {getReceivedAmount(selectedProduct.id)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                    {getRemainingFairShare(selectedProduct) > 0 && (
                      <> • נשאר מההקצבה שלך: {getRemainingFairShare(selectedProduct)}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}</>
                    )}
                  </small>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowTransferModal(false)}>
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary" style={{
                    background: 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)',
                    border: 'none'
                  }}>
                    העבר
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showRequestModal && selectedProduct && (
          <div className="modal" onClick={() => setShowRequestModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
              background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}>
              <div className="modal-header" style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1.5rem',
                borderRadius: '20px 20px 0 0',
                borderBottom: '2px solid rgba(255, 255, 255, 0.2)'
              }}>
                <h2 style={{ color: 'white', margin: 0, fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Send size={24} />
                  בקשת הקצבה - {selectedProduct.name}
                </h2>
                <button className="close-btn" onClick={() => setShowRequestModal(false)} style={{
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
                }}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleRequestSubmit} style={{ padding: '1.5rem', background: 'white' }}>
                <div className="form-group">
                  <label>כמות לבקשה:</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={requestForm.quantity}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      if (value < 1) {
                        setRequestForm({ ...requestForm, quantity: '1' });
                      } else {
                        setRequestForm({ ...requestForm, quantity: e.target.value });
                      }
                    }}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>בקש מ:</label>
                  <select
                    value={requestForm.toMemberId}
                    onChange={(e) => setRequestForm({ ...requestForm, toMemberId: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                  >
                    <option value="">בחר משתמש</option>
                    {members
                      .filter(m => {
                        if (m.id === selectedMember.id) return false;
                        if (!isMemberEligibleForProduct(selectedProduct, m)) return false;
                        const remaining = getMemberRemainingFairShare(selectedProduct, m.id);
                        return remaining > 0;
                      })
                      .map(member => {
                        const remaining = getMemberRemainingFairShare(selectedProduct, member.id);
                        return (
                          <option key={member.id} value={member.id}>
                            {member.name} {member.isChild ? '(ילד)' : '(מבוגר)'} - נשאר לו: {remaining}{selectedProduct.unit ? ` ${selectedProduct.unit}` : ''}
                          </option>
                        );
                      })}
                    {members
                      .filter(m => {
                        if (m.id === selectedMember.id) return false;
                        if (!isMemberEligibleForProduct(selectedProduct, m)) return false;
                        const remaining = getMemberRemainingFairShare(selectedProduct, m.id);
                        return remaining <= 0;
                      })
                      .map(member => (
                        <option key={member.id} value={member.id} disabled style={{ color: '#999' }}>
                          {member.name} {member.isChild ? '(ילד)' : '(מבוגר)'} - למשתמש נגמר המלאי במוצר
                        </option>
                      ))}
                  </select>
                </div>
                {requestForm.toMemberId && (() => {
                  const selectedToMember = members.find(m => m.id === parseInt(requestForm.toMemberId));
                  if (selectedToMember) {
                    if (!isMemberEligibleForProduct(selectedProduct, selectedToMember)) {
                      return (
                        <div style={{ 
                          padding: '0.75rem', 
                          background: '#fff3e0', 
                          color: '#e65100', 
                          borderRadius: '8px',
                          marginTop: '0.5rem',
                          border: '1px solid #ffb74d'
                        }}>
                          ⚠️ לפי חוק החלוקה של המוצר אי אפשר לבקש הקצבה מהמשתמש הזה
                        </div>
                      );
                    }
                    const remaining = getMemberRemainingFairShare(selectedProduct, selectedToMember.id);
                    if (remaining <= 0) {
                      return (
                        <div style={{ 
                          padding: '0.75rem', 
                          background: '#ffebee', 
                          color: '#c62828', 
                          borderRadius: '8px',
                          marginTop: '0.5rem',
                          border: '1px solid #ef5350'
                        }}>
                          ⚠️ למשתמש נגמר המלאי במוצר
                        </div>
                      );
                    }
                  }
                  return null;
                })()}
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowRequestModal(false)}>
                    <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    ביטול
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    style={{
                      background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                    disabled={requestForm.toMemberId && (() => {
                      const selectedToMember = members.find(m => m.id === parseInt(requestForm.toMemberId));
                      if (selectedToMember) {
                        if (!isMemberEligibleForProduct(selectedProduct, selectedToMember)) return true;
                        const remaining = getMemberRemainingFairShare(selectedProduct, selectedToMember.id);
                        return remaining <= 0;
                      }
                      return false;
                    })()}
                  >
                    <Send size={18} />
                    שלח בקשה
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showDepositModal && selectedProduct && (
          <div className="modal" onClick={() => setShowDepositModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
              background: 'linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
              maxWidth: '500px',
              width: '90%'
            }}>
              <div className="modal-header" style={{ 
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1.5rem',
                borderRadius: '20px 20px 0 0',
                borderBottom: '2px solid rgba(255, 255, 255, 0.2)'
              }}>
                <h2 style={{ color: 'white', margin: 0, fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Wallet size={24} />
                  הפקדת פיקדון - {selectedProduct.name}
                </h2>
                <button className="close-btn" onClick={() => setShowDepositModal(false)} style={{
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
                }}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleDepositSubmit} style={{ padding: '1.5rem', background: 'white' }}>
                <div className="form-group">
                  <label>סכום הפיקדון (₪):</label>
                  <input
                    type="number"
                    step="0.01"
                    min="50"
                    max="1000"
                    value={depositForm.amount}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 0;
                      if (value > 1000) {
                        setDepositForm({ ...depositForm, amount: '1000' });
                      } else if (value < 50 && value > 0) {
                        setDepositForm({ ...depositForm, amount: '50' });
                      } else {
                        setDepositForm({ ...depositForm, amount: e.target.value });
                      }
                    }}
                    required
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                  />
                  <small style={{ color: '#666', marginTop: '0.25rem', display: 'block' }}>
                    סכום מינימלי: 50 ₪ | סכום מקסימלי: 1000 ₪
                  </small>
                </div>

                <div className="form-group" style={{ marginTop: '1.5rem' }}>
                  <label>אמצעי תשלום:</label>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <label style={{ 
                      flex: 1, 
                      padding: '1rem', 
                      border: depositForm.paymentMethod === 'card' ? '2px solid #9C27B0' : '2px solid #ddd',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: depositForm.paymentMethod === 'card' ? 'rgba(156, 39, 176, 0.1)' : 'white',
                      transition: 'all 0.3s ease'
                    }}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="card"
                        checked={depositForm.paymentMethod === 'card'}
                        onChange={(e) => setDepositForm({ ...depositForm, paymentMethod: e.target.value })}
                        style={{ marginLeft: '0.5rem' }}
                      />
                      <CreditCard size={18} style={{ marginLeft: '0.5rem' }} />
                      כרטיס אשראי
                    </label>
                    <label style={{ 
                      flex: 1, 
                      padding: '1rem', 
                      border: depositForm.paymentMethod === 'cash' ? '2px solid #4CAF50' : '2px solid #ddd',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: depositForm.paymentMethod === 'cash' ? 'rgba(76, 175, 80, 0.1)' : 'white',
                      transition: 'all 0.3s ease'
                    }}>
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="cash"
                        checked={depositForm.paymentMethod === 'cash'}
                        onChange={(e) => setDepositForm({ ...depositForm, paymentMethod: e.target.value })}
                        style={{ marginLeft: '0.5rem' }}
                      />
                      <DollarSign size={18} style={{ marginLeft: '0.5rem' }} />
                      מזומן
                    </label>
                  </div>
                </div>
                
                {depositForm.paymentMethod === 'card' && (
                <div style={{ 
                  background: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)',
                  padding: '1.5rem',
                  borderRadius: '15px',
                  marginTop: '1.5rem',
                  border: '2px solid #9C27B0'
                }}>
                  <h3 style={{ margin: '0 0 1rem 0', color: '#333', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CreditCard size={20} />
                    פרטי כרטיס אשראי
                  </h3>
                  
                  <div className="form-group">
                    <label>מספר כרטיס אשראי:</label>
                    <input
                      type="text"
                      maxLength="19"
                      placeholder="1234 5678 9012 3456"
                      value={depositForm.cardNumber}
                      onChange={(e) => {
                        let value = e.target.value.replace(/\s/g, '').replace(/\D/g, '');
                        if (value.length > 16) value = value.slice(0, 16);
                        // Add spaces every 4 digits
                        value = value.match(/.{1,4}/g)?.join(' ') || value;
                        setDepositForm({ ...depositForm, cardNumber: value });
                      }}
                      required={depositForm.paymentMethod === 'card'}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd', fontFamily: 'monospace' }}
                    />
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                      <label>תוקף (MM/YY):</label>
                      <input
                        type="text"
                        maxLength="5"
                        placeholder="12/25"
                        value={depositForm.expiryDate}
                        onChange={(e) => {
                          let value = e.target.value.replace(/\D/g, '');
                          if (value.length >= 2) {
                            value = value.slice(0, 2) + '/' + value.slice(2, 4);
                          }
                          setDepositForm({ ...depositForm, expiryDate: value });
                        }}
                        required={depositForm.paymentMethod === 'card'}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>CVV:</label>
                      <input
                        type="text"
                        maxLength="4"
                        placeholder="123"
                        value={depositForm.cvv}
                        onChange={(e) => {
                          let value = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setDepositForm({ ...depositForm, cvv: value });
                        }}
                        required={depositForm.paymentMethod === 'card'}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                      />
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>תעודת זהות:</label>
                    <input
                      type="text"
                      maxLength="9"
                      placeholder="123456789"
                      value={depositForm.idNumber}
                      onChange={(e) => {
                        let value = e.target.value.replace(/\D/g, '').slice(0, 9);
                        setDepositForm({ ...depositForm, idNumber: value });
                      }}
                      required={depositForm.paymentMethod === 'card'}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ddd' }}
                    />
                  </div>
                </div>
                )}
                
                {depositForm.paymentMethod === 'cash' && (
                  <div style={{ 
                    background: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)',
                    padding: '1.5rem',
                    borderRadius: '15px',
                    marginTop: '1.5rem',
                    border: '2px solid #4CAF50',
                    textAlign: 'center'
                  }}>
                    <DollarSign size={48} style={{ marginBottom: '0.5rem', color: '#4CAF50' }} />
                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#333', fontSize: '1.2rem' }}>תשלום במזומן</h3>
                    <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>
                      הסכום יגבה ממך במזומן בעת איסוף המוצר
                    </p>
                  </div>
                )}
                
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowDepositModal(false)}>
                    <X size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary" style={{
                    background: depositForm.paymentMethod === 'cash' 
                      ? 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)'
                      : 'linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {depositForm.paymentMethod === 'cash' ? (
                      <>
                        <DollarSign size={18} />
                        שלח פיקדון במזומן
                      </>
                    ) : (
                      <>
                        <CreditCard size={18} />
                        שלח תשלום
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UserPanel;
