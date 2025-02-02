import React, { createContext, useState, useContext } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState([{ username: 'admin', password: 'password' }]);

  const signup = (username, password) => {
    if (users.find((user) => user.username === username)) {
      return { success: false, message: 'Username already exists' };
    }
    setUsers([...users, { username, password }]);
    return { success: true };
  };

  const login = (username, password) => {
    const user = users.find((u) => u.username === username && u.password === password);
    if (user) {
      setUser({ username });
      return { success: true };
    }
    return { success: false, message: 'Invalid credentials' };
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, signup }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
