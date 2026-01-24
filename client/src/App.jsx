import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { UtensilsCrossed, Settings, User, Home as HomeIcon } from 'lucide-react';
import AdminPanel from './components/AdminPanel';
import UserPanel from './components/UserPanel';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <nav className="main-nav">
          <div className="nav-container">
            <h1 className="logo">
              <UtensilsCrossed size={24} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
              ניהול אוכל משפחתי
            </h1>
            <div className="nav-links">
              <Link to="/admin" className="nav-link">
                <Settings size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                ממשק ניהול
              </Link>
              <Link to="/user" className="nav-link">
                <User size={18} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
                ממשק משתמש
              </Link>
            </div>
          </div>
        </nav>
        
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/user" element={<UserPanel />} />
        </Routes>
      </div>
    </Router>
  );
}

function Home() {
  const navigate = useNavigate();
  
  return (
    <div className="home-container">
      <div className="home-card">
        <HomeIcon size={48} style={{ marginBottom: '1rem', color: '#667eea' }} />
        <h2>ברוכים הבאים!</h2>
        <p>בחרו את הממשק המתאים לכם:</p>
        <div className="home-buttons">
          <button onClick={() => navigate('/admin')} className="btn btn-primary">
            <Settings size={20} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
            ממשק ניהול
          </button>
          <button onClick={() => navigate('/user')} className="btn btn-secondary">
            <User size={20} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} />
            ממשק משתמש
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
