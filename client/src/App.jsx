import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import AdminPanel from './components/AdminPanel';
import UserPanel from './components/UserPanel';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <nav className="main-nav">
          <div className="nav-container">
            <h1 className="logo">🍽️ ניהול אוכל משפחתי</h1>
            <div className="nav-links">
              <Link to="/admin" className="nav-link">ממשק ניהול</Link>
              <Link to="/user" className="nav-link">ממשק משתמש</Link>
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
        <h2>ברוכים הבאים!</h2>
        <p>בחרו את הממשק המתאים לכם:</p>
        <div className="home-buttons">
          <button onClick={() => navigate('/admin')} className="btn btn-primary">
            ממשק ניהול
          </button>
          <button onClick={() => navigate('/user')} className="btn btn-secondary">
            ממשק משתמש
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
