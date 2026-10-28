// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from 'react';
import Header from './Header/Header';

const TopBar = ({ user, firstName, handleLogin, handleLogout, showUserMenu, setShowUserMenu, isAuthenticated }) => {

  return (
    <div className="fixed top-0 left-0 right-0 h-16 bg-gradient-to-r from-[#1a365d] to-[#2c5282] text-white flex items-center px-4 justify-between z-50">
      <div>
        <span className="font-bold">Capricorn</span>{' '}
        <span className="font-light">| Medical Research (Demo)</span>
      </div>
      <Header
        user={user}
        firstName={firstName}
        handleLogin={handleLogin}
        handleLogout={handleLogout}
        showUserMenu={showUserMenu}
        setShowUserMenu={setShowUserMenu}
        isAuthenticated={isAuthenticated}
      />
    </div>
  );
};

export default TopBar;
