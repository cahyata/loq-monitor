# LOQ Monitor

A read-only view of the health of one laptop's hardware.

## Language

**Page**:
One of the views of the main window, opened by its tab or number key.
_Avoid_: Tab (that is the button), screen, view

**Snapshot**:
All values the sensor service measured at one moment.
_Avoid_: Frame, sample

**Reading**:
One measured value in a **Snapshot**, such as a temperature, a fill level or a speed.
_Avoid_: Metric, stat

**Limit**:
A value at which a **Reading** starts to need attention.
_Avoid_: Threshold, boundary

**Drive life**:
The share of its rated endurance that a drive reports as remaining.
_Avoid_: Health, wear

**Level**:
How much attention a **Reading** needs: Normal, Warning or Critical.
_Avoid_: State, status, severity

**Finding**:
A **Reading** or condition in a **Snapshot** whose **Level** is Warning or Critical.
_Avoid_: Alert, issue
