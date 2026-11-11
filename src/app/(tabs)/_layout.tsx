import { StatusBar } from "expo-status-bar";
import { Tabs } from "expo-router/tabs";
import type { ColorValue } from "react-native";
import { AppTabBar } from "@/components/app-tab-bar";
import { Icon, type IconName } from "@/components/icon";
import { colors } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon name={name} size={size} color={color} />
  );
}

/** Signed-in area. The root layout's guard keeps signed-out users out of it. */
export default function TabsLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.ui.screen },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Home", tabBarIcon: tabIcon("home") }}
        />
        <Tabs.Screen
          name="team"
          options={{ title: "Team", tabBarIcon: tabIcon("account_tree") }}
        />
        <Tabs.Screen
          name="search"
          options={{ title: "Search", tabBarIcon: tabIcon("search") }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: "Settings", tabBarIcon: tabIcon("settings") }}
        />
      </Tabs>
    </>
  );
}
