jest.mock('firebase/app',()=>({initializeApp:jest.fn(()=>({name:'synthetic'}))}));
jest.mock('firebase/auth',()=>({getAuth:jest.fn(()=>({}))}));
jest.mock('firebase/firestore',()=>({getFirestore:jest.fn(()=>({}))}));
const {initializeApp}=require('firebase/app');
const {getFirestore}=require('firebase/firestore');
test('initializes the configured Firebase app with an explicitly named database',()=>{
 const previous=process.env.REACT_APP_FIREBASE_DATABASE_ID;process.env.REACT_APP_FIREBASE_DATABASE_ID='synthetic-db';
 initializeApp.mockReturnValue({name:'synthetic'});require('./firebase');expect(initializeApp).toHaveBeenCalledTimes(1);expect(getFirestore).toHaveBeenCalledWith({name:'synthetic'},'synthetic-db');
 if(previous===undefined)delete process.env.REACT_APP_FIREBASE_DATABASE_ID;else process.env.REACT_APP_FIREBASE_DATABASE_ID=previous;
});
