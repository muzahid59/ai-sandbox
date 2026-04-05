import React from 'react';
import './App.css';
import ChatContainer from './components/ChatContainer/ChatContainer';
import Sidebar from './components/Sidebar/Sidebar';

function App() {
  return (
    <div className="App">
      <Sidebar />
      <div className="mainContent">
        <ChatContainer />
      </div>
    </div>
  );
}

export default App;
