import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Users, Package, Plus, Edit, Trash2, History, X, Save, 
  UserPlus, PackagePlus, Calendar, Clock, ArrowRightLeft, 
  FileText, AlertCircle
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
  const [editingMember, setEditingMember] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedProductHistory, setSelectedProductHistory] = useState(null);
  const [productTransactions, setProductTransactions] = useState([]);
  
  const [memberForm, setMemberForm] = useState({ name: '', isChild: false, gender: '' });
  const [productForm, setProductForm] = useState({ 
    name: '', 
    quantity: '', 
    unit: '', 
    ruleType: 'everyone' 
  });

  useEffect(() => {
    fetchData();
  }, []);

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
      setSelectedProductHistory(product);
      const [transactionsRes, transfersRes] = await Promise.all([
        axios.get(`${API_URL}/transactions`),
        axios.get(`${API_URL}/share-transfers?productId=${product.id}`)
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

  const handleMemberSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingMember) {
        await axios.put(`${API_URL}/family-members/${editingMember.id}`, memberForm);
      } else {
        await axios.post(`${API_URL}/family-members`, memberForm);
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
      if (editingProduct) {
        await axios.put(`${API_URL}/products/${editingProduct.id}`, productForm);
      } else {
        await axios.post(`${API_URL}/products`, productForm);
      }
      setShowProductModal(false);
      setEditingProduct(null);
      setProductForm({ name: '', quantity: '', unit: '', ruleType: 'everyone' });
      fetchData();
    } catch (error) {
      console.error('Error saving product:', error);
      alert('שגיאה בשמירת הנתונים');
    }
  };

  const handleDeleteMember = async (id) => {
    if (window.confirm('האם אתם בטוחים שברצונכם למחוק את חבר המשפחה?')) {
      try {
        await axios.delete(`${API_URL}/family-members/${id}`);
        fetchData();
      } catch (error) {
        console.error('Error deleting member:', error);
        alert('שגיאה במחיקת הנתונים');
      }
    }
  };

  const handleDeleteProduct = async (id) => {
    if (window.confirm('האם אתם בטוחים שברצונכם למחוק את המוצר?')) {
      try {
        await axios.delete(`${API_URL}/products/${id}`);
        fetchData();
      } catch (error) {
        console.error('Error deleting product:', error);
        alert('שגיאה במחיקת הנתונים');
      }
    }
  };

  const handleEditMember = (member) => {
    setEditingMember(member);
    setMemberForm({ name: member.name, isChild: member.isChild, gender: member.gender || '' });
    setShowMemberModal(true);
  };

  const handleEditProduct = (product) => {
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
                        <span className="badge badge-warning">
                          {member.gender === 'male' ? 'זכר' : member.gender === 'female' ? 'נקבה' : 'אחר'}
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>לא הוגדר</span>
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
              <button 
                className="btn btn-primary"
                onClick={() => {
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
      </div>
    </div>
  );
}

export default AdminPanel;
