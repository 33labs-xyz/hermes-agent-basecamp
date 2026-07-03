"use client";

import { useState, useEffect } from 'react';
import { CreativeCanvas } from 'design-agent';

import { getUserBalance } from '../muapi';

export default function DesignAgentStudio({ apiKey, isHeaderVisible, onToggleHeader }) {
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    sessionStorage.setItem("fromDesignAgent", "true");
    if (!apiKey) return;
    // Vendor deviation: upstream persisted the key to localStorage("token")
    // for CreativeCanvas's Authorization header. Basecamp keeps the key out
    // of plaintext disk storage; the axios shim injects x-api-key instead.

    const fetchUser = async () => {
      try {
        const data = await getUserBalance(apiKey);
        setUserData({
          username: data.email?.split('@')[0] || 'Studio User',
          email: data.email,
          balance: data.balance || 0
        });
      } catch (err) {
        console.error('Failed to fetch user data for Design Agent:', err);
      }
    };

    fetchUser();
  }, [apiKey]);

  return (
    <div className="h-full w-full bg-black overflow-hidden design-agent-studio">
      <CreativeCanvas 
        user={userData}
        isAuthorized={!!userData}
        creditConversionRate={200}
        theme="dark"
        onToggleHeader={onToggleHeader}
        isHeaderVisible={isHeaderVisible}
      />
    </div>
  );
}
