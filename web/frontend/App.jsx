import { BrowserRouter } from "react-router-dom";
import { NavigationMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";
import  warehouseContext from "./components/warehouseContext";
import { useState } from "react";


import {
  AppBridgeProvider,
  GraphQLProvider,
  PolarisProvider,
  // warehouseContext
} from "./components";


// import { DBConfig } from './DBConfig';
// import { initDB } from 'react-indexed-db';


export default function App() {
  // Any .tsx or .jsx files in /pages will become a route
  // See documentation for <Routes /> for more info
  const pages = import.meta.globEager("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

  
  const [orderItemWarehouse, setOrderItemWarehouse] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([]);


  const updateOrderItemWarehouseFunction = (orderItemWarehouseList) => {
    // this.setState((state) => {
    let newOrderItemWarehouseList = [...orderItemWarehouse];
    orderItemWarehouseList.forEach(orderItemWarehouse => {
      newOrderItemWarehouseList.find(row => (row.orderId == orderItemWarehouse.orderId) && (row.itemId == orderItemWarehouse.itemId)) ?
        newOrderItemWarehouseList.find(row => (row.orderId == orderItemWarehouse.orderId) && (row.itemId == orderItemWarehouse.itemId)).warehouse = orderItemWarehouse.warehouse : newOrderItemWarehouseList.push(orderItemWarehouse)

    })
    console.log("newOrderItemWarehouseList from _app", newOrderItemWarehouseList);
    setOrderItemWarehouse(newOrderItemWarehouseList);
    // return { orderItemWarehouse: newOrderItemWarehouseList }
    // })

  }

  const setOrderItemWarehouseFunction = (orderItemWarehouse) => {
    setOrderItemWarehouse(orderItemWarehouse);
  }

  const updateWarehouseOptions = (warehouseOptions) => {
    console.log(`Updating warehouseOptions: ${warehouseOptions}`)
    setWarehouseOptions(warehouseOptions);
  }


  return (
    <PolarisProvider>
      <warehouseContext.Provider value={{ warehouseOptions: warehouseOptions, updateWarehouseOptions: updateWarehouseOptions, orderItemWarehouse: orderItemWarehouse, updateOrderItemWarehouse: updateOrderItemWarehouseFunction, setOrderItemWarehouse: setOrderItemWarehouseFunction }}>
        <BrowserRouter>
          <AppBridgeProvider>
            <GraphQLProvider>
              <NavigationMenu
                navigationLinks={[
                  {
                    label: "Orders",
                    destination: "/",
                  },
                  {
                    label: "Print-AWB",
                    destination: "/awb",
                  },
                ]}
              />
              <Routes pages={pages} />
            </GraphQLProvider>
          </AppBridgeProvider>
        </BrowserRouter>
      </warehouseContext.Provider>
    </PolarisProvider >
  );
}
