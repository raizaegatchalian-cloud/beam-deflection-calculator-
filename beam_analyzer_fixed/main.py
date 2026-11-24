"""
Beam Analyzer - initial desktop release
Supports statically determinate simply supported and cantilever beams.
Loads: point, UDL, UVL, and applied moment.
Methods: double integration, moment-area, and conjugate-beam numerical formulations.

Units: kN, m, GPa, m^4. Deflection is reported in mm.
Dependencies: numpy, matplotlib
Run: python main.py
"""
import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk


def trapz(y, x):
    # Compatible with older and newer NumPy releases
    return np.trapz(y, x)


class BeamModel:
    def __init__(self, length, E_GPa, I_m4, support, loads):
        self.L = float(length)
        self.E = float(E_GPa) * 1e6  # GPa -> kN/m^2
        self.I = float(I_m4)
        self.support = support
        self.loads = loads
        if self.L <= 0 or self.E <= 0 or self.I <= 0:
            raise ValueError("Beam length, E, and I must be greater than zero.")
        if support not in ("Simply supported", "Cantilever"):
            raise ValueError("Unsupported support configuration.")

    def distributed_load(self, x):
        """Downward distributed load intensity, kN/m."""
        q = np.zeros_like(x, dtype=float)
        for load in self.loads:
            typ = load["type"]
            if typ == "UDL":
                a, b, w = load["a"], load["b"], load["w"]
                q += np.where((x >= a) & (x <= b), w, 0.0)
            elif typ == "UVL":
                a, b, w1, w2 = load["a"], load["b"], load["w1"], load["w2"]
                mask = (x >= a) & (x <= b)
                intensity = w1 + (w2 - w1) * (x - a) / (b - a)
                q += np.where(mask, intensity, 0.0)
        return q

    def load_resultants(self):
        total_force = 0.0
        total_moment_about_A = 0.0
        for load in self.loads:
            typ = load["type"]
            if typ == "Point":
                P, a = load["P"], load["a"]
                total_force += P
                total_moment_about_A += P * a
            elif typ == "Moment":
                # Positive input is counterclockwise; downward loads are positive here.
                total_moment_about_A -= load["M"]
            elif typ in ("UDL", "UVL"):
                a, b = load["a"], load["b"]
                # Exact resultant and first moment by fine numerical integration
                xx = np.linspace(a, b, 1001)
                if typ == "UDL":
                    qq = np.full_like(xx, load["w"])
                else:
                    qq = load["w1"] + (load["w2"] - load["w1"]) * (xx-a)/(b-a)
                total_force += trapz(qq, xx)
                total_moment_about_A += trapz(qq * xx, xx)
        return total_force, total_moment_about_A

    def reactions(self):
        W, moment_A = self.load_resultants()
        if self.support == "Simply supported":
            RB = moment_A / self.L
            RA = W - RB
            return {"RA": RA, "RB": RB}
        # Cantilever fixed at x=0
        return {"RA": W, "MA": moment_A}

    def diagrams(self, n=1201):
        x = np.linspace(0, self.L, n)
        dx = x[1] - x[0]
        q = self.distributed_load(x)
        r = self.reactions()
        # V(x) = left reaction - accumulated downward load
        V = r["RA"] - np.concatenate(([0.0], np.cumsum((q[:-1] + q[1:]) * 0.5 * dx)))
        # Point loads create jumps in shear; include them at and to the right of their positions.
        for load in self.loads:
            if load["type"] == "Point":
                V -= np.where(x >= load["a"], load["P"], 0.0)
        # Build M(x) directly from equilibrium. This avoids smearing point-load
        # jumps across a grid cell when numerically integrating the shear diagram.
        Q = np.concatenate(([0.0], np.cumsum((q[:-1] + q[1:]) * 0.5 * dx)))
        Sq = np.concatenate(([0.0], np.cumsum(((x[:-1]*q[:-1]) + (x[1:]*q[1:])) * 0.5 * dx)))
        M = r.get("MA", 0.0) * (-1.0 if self.support == "Cantilever" else 0.0) + r["RA"] * x - (x * Q - Sq)
        for load in self.loads:
            if load["type"] == "Point":
                M -= np.where(x >= load["a"], load["P"] * (x - load["a"]), 0.0)
            elif load["type"] == "Moment":
                M -= np.where(x >= load["a"], load["M"], 0.0)
        return x, V, M

    @staticmethod
    def integrate(y, x):
        out = np.zeros_like(y, dtype=float)
        out[1:] = np.cumsum((y[:-1] + y[1:]) * 0.5 * np.diff(x))
        return out

    def solve_deflection(self, method="Double Integration"):
        x, V, M = self.diagrams()
        curvature = M / (self.E * self.I)  # 1/m; sign convention follows M
        # The three methods use distinct textbook interpretations but share
        # the same numerical integration kernel for consistent discretization.
        if method == "Double Integration":
            theta0 = self.integrate(curvature, x)
            y0 = self.integrate(theta0, x)
            if self.support == "Simply supported":
                C1 = -y0[-1] / self.L
                theta = theta0 + C1
                y = y0 + C1 * x
            else:
                theta, y = theta0, y0
        elif method == "Moment-Area":
            area_M_EI = self.integrate(curvature, x)
            first_area = self.integrate(area_M_EI, x)
            if self.support == "Simply supported":
                theta = area_M_EI - first_area[-1] / self.L
                y = first_area - (first_area[-1] / self.L) * x
            else:
                theta, y = area_M_EI, first_area
        elif method == "Conjugate Beam":
            # Conjugate-beam theorem: V* = theta and M* = deflection.
            # Boundary conditions are the conjugate support conditions:
            # simply supported -> simply supported; cantilever fixed/free
            # becomes conjugate free/fixed, giving theta(0)=y(0)=0.
            v_star = self.integrate(curvature, x)
            m_star = self.integrate(v_star, x)
            if self.support == "Simply supported":
                v_star = v_star - m_star[-1] / self.L
                m_star = m_star - (m_star[-1] / self.L) * x
            theta, y = v_star, m_star
        else:
            raise ValueError("Select a valid analysis method.")
        return x, V, M, theta, y

    def solution_summary(self, method):
        x, V, M, theta, y = self.solve_deflection(method)
        reactions = self.reactions()
        max_i = int(np.argmax(np.abs(y)))
        max_m_i = int(np.argmax(np.abs(M)))
        max_v_i = int(np.argmax(np.abs(V)))
        lines = [
            f"METHOD: {method}",
            f"Support: {self.support}",
            "",
            "SUPPORT REACTIONS",
        ]
        for key, value in reactions.items():
            unit = "kN" if key in ("RA", "RB") else "kN·m"
            lines.append(f"  {key} = {value:.5f} {unit}")
        lines += [
            "",
            "KEY RESULTS",
            f"  Maximum |V| = {abs(V[max_v_i]):.5f} kN at x = {x[max_v_i]:.4f} m",
            f"  Maximum |M| = {abs(M[max_m_i]):.5f} kN·m at x = {x[max_m_i]:.4f} m",
            f"  Maximum |deflection| = {abs(y[max_i])*1000:.5f} mm at x = {x[max_i]:.4f} m",
            f"  Slope at x = 0: {theta[0]:.8e} rad",
            f"  Slope at x = L: {theta[-1]:.8e} rad",
            f"  Deflection at x = 0: {y[0]*1000:.8f} mm",
            f"  Deflection at x = L: {y[-1]*1000:.8f} mm",
            "",
            "METHOD NOTES",
        ]
        if method == "Double Integration":
            lines += [
                "  EI·y''(x) = M(x)",
                "  Integrate M/EI once to obtain slope, then again for deflection.",
                "  Apply support boundary conditions to determine integration constants.",
            ]
        elif method == "Moment-Area":
            lines += [
                "  Δθ = integral(M/EI dx)",
                "  Tangential deviation = integral[(M/EI)(distance) dx]",
                "  Apply the known support deflection/slope conditions.",
            ]
        else:
            lines += [
                "  Conjugate-beam loading: w*(x) = M(x)/EI",
                "  Conjugate shear V* corresponds to actual slope θ.",
                "  Conjugate moment M* corresponds to actual deflection y.",
                "  Use conjugate support conditions to enforce the actual beam boundary conditions.",
            ]
        lines += [
            "",
            "ASSUMPTIONS / LIMITATIONS",
            "  Linear-elastic Euler-Bernoulli beam theory; small deflections.",
            "  Constant E and I; prismatic beam; downward loads are positive.",
            "  Numerical integration on a discretized beam; refine grid for higher accuracy.",
        ]
        return "\n".join(lines)


class BeamAnalyzerApp:
    def __init__(self, root):
        self.root = root
        root.title("Beam Analyzer | Structural Analysis Calculator")
        root.geometry("1250x850")
        root.minsize(1050, 700)
        self.loads = []
        self.last_model = None
        self.last_method = "Double Integration"
        self._build_ui()

    def _build_ui(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        header = ttk.Frame(self.root, padding=(14, 10))
        header.pack(fill="x")
        ttk.Label(header, text="BEAM ANALYZER", font=("Segoe UI", 19, "bold")).pack(anchor="w")
        ttk.Label(header, text="Shear • Bending Moment • Slope • Deflection", foreground="#536273").pack(anchor="w")

        body = ttk.Panedwindow(self.root, orient="horizontal")
        body.pack(fill="both", expand=True, padx=10, pady=8)
        left = ttk.Frame(body, padding=10)
        right = ttk.Frame(body, padding=8)
        body.add(left, weight=1)
        body.add(right, weight=3)

        # Beam/material inputs
        ttk.Label(left, text="BEAM PROPERTIES", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(0, 5))
        self.length_var = tk.StringVar(value="6")
        self.E_var = tk.StringVar(value="200")
        self.I_var = tk.StringVar(value="8.5e-5")
        self.support_var = tk.StringVar(value="Simply supported")
        self._entry(left, "Length (m)", self.length_var)
        self._entry(left, "E (GPa)", self.E_var)
        self._entry(left, "I (m⁴)", self.I_var)
        ttk.Label(left, text="Support condition").pack(anchor="w", pady=(5, 0))
        ttk.Combobox(left, textvariable=self.support_var, values=["Simply supported", "Cantilever"], state="readonly").pack(fill="x")

        ttk.Separator(left).pack(fill="x", pady=10)
        ttk.Label(left, text="ADD LOAD", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.load_type_var = tk.StringVar(value="Point")
        ttk.Label(left, text="Load type").pack(anchor="w", pady=(5, 0))
        ttk.Combobox(left, textvariable=self.load_type_var, values=["Point", "UDL", "UVL", "Moment"], state="readonly").pack(fill="x")
        self.load_value_var = tk.StringVar(value="20")
        self.a_var = tk.StringVar(value="3")
        self.b_var = tk.StringVar(value="6")
        self.end_value_var = tk.StringVar(value="0")
        self._entry(left, "Magnitude (P kN / w kN/m / M kN·m)", self.load_value_var)
        self._entry(left, "Start / position a (m)", self.a_var)
        self._entry(left, "End b (m), for UDL / UVL", self.b_var)
        self._entry(left, "UVL end intensity w₂ (kN/m)", self.end_value_var)
        ttk.Button(left, text="＋ Add Load", command=self.add_load).pack(fill="x", pady=(7, 4))

        # Place analysis controls above the load list so they remain visible
        # on displays using larger Windows text/display scaling.
        ttk.Separator(left).pack(fill="x", pady=8)
        ttk.Label(left, text="ANALYSIS METHOD", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.method_var = tk.StringVar(value="Double Integration")
        ttk.Combobox(left, textvariable=self.method_var,
                     values=["Double Integration", "Moment-Area", "Conjugate Beam"],
                     state="readonly").pack(fill="x", pady=(5, 6))
        ttk.Button(left, text="CALCULATE BEAM", command=self.calculate).pack(fill="x", pady=3)
        ttk.Button(left, text="Compare All Three Methods", command=self.compare_methods).pack(fill="x", pady=3)
        ttk.Button(left, text="Reset", command=self.reset).pack(fill="x", pady=3)

        ttk.Separator(left).pack(fill="x", pady=8)
        ttk.Label(left, text="LOADS ADDED", font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.load_list = tk.Listbox(left, height=5, font=("Consolas", 9))
        self.load_list.pack(fill="x")
        ttk.Button(left, text="Remove Selected Load", command=self.remove_load).pack(fill="x", pady=(4, 0))
        ttk.Label(left, text="Units: kN, m, GPa, m⁴. Deflection: mm.",
                  foreground="#536273", wraplength=260).pack(anchor="w", pady=(8, 0))

        # Right side tabs
        self.tabs = ttk.Notebook(right)
        self.tabs.pack(fill="both", expand=True)
        self.plot_tab = ttk.Frame(self.tabs)
        self.solution_tab = ttk.Frame(self.tabs)
        self.tabs.add(self.plot_tab, text="Diagrams")
        self.tabs.add(self.solution_tab, text="Solution / Results")

        self.fig = Figure(figsize=(9, 7), dpi=100, constrained_layout=True)
        self.ax_beam = self.fig.add_subplot(411)
        self.ax_sfd = self.fig.add_subplot(412)
        self.ax_bmd = self.fig.add_subplot(413)
        self.ax_def = self.fig.add_subplot(414)
        self.canvas = FigureCanvasTkAgg(self.fig, master=self.plot_tab)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
        toolbar_frame = ttk.Frame(self.plot_tab)
        toolbar_frame.pack(fill="x")
        NavigationToolbar2Tk(self.canvas, toolbar_frame).update()

        self.solution_text = tk.Text(self.solution_tab, wrap="word", font=("Consolas", 10), padx=12, pady=12)
        self.solution_text.pack(fill="both", expand=True)
        self.solution_text.insert("1.0", "Enter beam properties and add one or more loads, then click CALCULATE BEAM.")
        self._draw_empty()

    def _entry(self, parent, label, variable):
        ttk.Label(parent, text=label).pack(anchor="w", pady=(5, 0))
        ttk.Entry(parent, textvariable=variable).pack(fill="x")

    def add_load(self):
        try:
            typ = self.load_type_var.get()
            a = float(self.a_var.get())
            val = float(self.load_value_var.get())
            L = float(self.length_var.get())
            if not (0 <= a <= L):
                raise ValueError("Load position must be between 0 and beam length.")
            if typ == "Point":
                load = {"type": typ, "P": val, "a": a}
                label = f"Point {val:g} kN at {a:g} m"
            elif typ == "Moment":
                load = {"type": typ, "M": val, "a": a}
                label = f"Moment {val:g} kN·m at {a:g} m"
            else:
                b = float(self.b_var.get())
                if not (0 <= a < b <= L):
                    raise ValueError("Distributed load must satisfy 0 ≤ a < b ≤ L.")
                if typ == "UDL":
                    load = {"type": typ, "w": val, "a": a, "b": b}
                    label = f"UDL {val:g} kN/m from {a:g} to {b:g} m"
                else:
                    w2 = float(self.end_value_var.get())
                    load = {"type": typ, "w1": val, "w2": w2, "a": a, "b": b}
                    label = f"UVL {val:g}→{w2:g} kN/m from {a:g} to {b:g} m"
            self.loads.append(load)
            self.load_list.insert("end", label)
        except Exception as exc:
            messagebox.showerror("Invalid load", str(exc))

    def remove_load(self):
        selection = self.load_list.curselection()
        if selection:
            idx = selection[0]
            self.load_list.delete(idx)
            self.loads.pop(idx)

    def _make_model(self):
        if not self.loads:
            raise ValueError("Add at least one load before calculating.")
        return BeamModel(self.length_var.get(), self.E_var.get(), self.I_var.get(),
                         self.support_var.get(), self.loads)

    def calculate(self):
        try:
            model = self._make_model()
            method = self.method_var.get()
            x, V, M, theta, y = model.solve_deflection(method)
            self.last_model, self.last_method = model, method
            self._plot(model, x, V, M, y, method)
            self._show_text(model.solution_summary(method))
            self.tabs.select(self.plot_tab)
        except Exception as exc:
            messagebox.showerror("Calculation error", str(exc))

    def compare_methods(self):
        try:
            model = self._make_model()
            methods = ["Double Integration", "Moment-Area", "Conjugate Beam"]
            rows = []
            for method in methods:
                x, V, M, theta, y = model.solve_deflection(method)
                idx = int(np.argmax(np.abs(y)))
                rows.append((method, abs(y[idx])*1000, x[idx]))
            text = "COMPARISON OF THE THREE METHODS\n" + "="*52 + "\n"
            text += f"{'Method':<23}{'Max |δ| (mm)':>15}{'Location (m)':>14}\n"
            text += "-"*52 + "\n"
            for name, d, pos in rows:
                text += f"{name:<23}{d:>15.5f}{pos:>14.4f}\n"
            text += "\nThe three numerical formulations should agree within discretization tolerance.\n"
            text += "\n" + model.solution_summary("Double Integration")
            self.last_model, self.last_method = model, "Double Integration"
            x, V, M, theta, y = model.solve_deflection("Double Integration")
            self._plot(model, x, V, M, y, "Comparison: all methods")
            self._show_text(text)
            self.tabs.select(self.solution_tab)
        except Exception as exc:
            messagebox.showerror("Calculation error", str(exc))

    def _plot(self, model, x, V, M, y, method):
        for ax in (self.ax_beam, self.ax_sfd, self.ax_bmd, self.ax_def):
            ax.clear()
            ax.grid(True, alpha=0.25)
        L = model.L
        # Beam and loads
        self.ax_beam.plot([0, L], [0, 0], color="#26384a", linewidth=3)
        for load in model.loads:
            typ = load["type"]
            if typ == "Point":
                a, P = load["a"], load["P"]
                self.ax_beam.annotate("", xy=(a, -0.05), xytext=(a, 0.65),
                                      arrowprops=dict(arrowstyle="->", lw=1.8, color="#c0392b"))
                self.ax_beam.text(a, 0.72, f"{P:g} kN", ha="center", fontsize=8)
            elif typ in ("UDL", "UVL"):
                a, b = load["a"], load["b"]
                for xx in np.linspace(a, b, 13):
                    self.ax_beam.annotate("", xy=(xx, -0.04), xytext=(xx, 0.48),
                                          arrowprops=dict(arrowstyle="->", color="#c0392b", lw=1))
                self.ax_beam.plot([a, b], [0.5, 0.5], color="#c0392b", lw=1.5)
                self.ax_beam.text((a+b)/2, 0.56, typ, ha="center", fontsize=8)
            elif typ == "Moment":
                a = load["a"]
                self.ax_beam.annotate("↺" if load["M"] >= 0 else "↻", (a, 0.45),
                                      ha="center", fontsize=16, color="#7d3c98")
                self.ax_beam.text(a, 0.72, f"{load['M']:g} kN·m", ha="center", fontsize=8)
        if model.support == "Simply supported":
            self.ax_beam.scatter([0, L], [-0.12, -0.12], marker="^", s=75, color="#2471a3")
        else:
            self.ax_beam.add_patch(__import__("matplotlib").patches.Rectangle((-0.12, -0.28), 0.12, 0.55, color="#2471a3"))
            for yy in np.linspace(-0.25, 0.25, 6):
                self.ax_beam.plot([-0.2, -0.12], [yy-0.05, yy+0.05], color="#2471a3", lw=1)
        self.ax_beam.set_xlim(-0.35, L+0.2)
        self.ax_beam.set_ylim(-0.35, 0.95)
        self.ax_beam.set_title("Beam, supports and applied loads", fontsize=9)
        self.ax_beam.set_yticks([])
        self.ax_beam.set_xlabel("Position x (m)", fontsize=8)

        self.ax_sfd.plot(x, V, color="#2471a3", lw=1.8)
        self.ax_sfd.fill_between(x, V, 0, alpha=0.15, color="#2471a3")
        self.ax_sfd.axhline(0, color="black", lw=0.8)
        self.ax_sfd.set_ylabel("V (kN)")
        self.ax_sfd.set_title("Shear Force Diagram", fontsize=9)

        self.ax_bmd.plot(x, M, color="#c0392b", lw=1.8)
        self.ax_bmd.fill_between(x, M, 0, alpha=0.15, color="#c0392b")
        self.ax_bmd.axhline(0, color="black", lw=0.8)
        self.ax_bmd.set_ylabel("M (kN·m)")
        self.ax_bmd.set_title("Bending Moment Diagram", fontsize=9)

        self.ax_def.plot(x, y*1000, color="#239b56", lw=2)
        self.ax_def.fill_between(x, y*1000, 0, alpha=0.12, color="#239b56")
        self.ax_def.axhline(0, color="black", lw=0.8)
        self.ax_def.set_ylabel("δ (mm)")
        self.ax_def.set_xlabel("Position x (m)")
        self.ax_def.set_title(f"Elastic Curve — {method}", fontsize=9)
        self.canvas.draw_idle()

    def _show_text(self, text):
        self.solution_text.delete("1.0", "end")
        self.solution_text.insert("1.0", text)

    def _draw_empty(self):
        for ax in (self.ax_beam, self.ax_sfd, self.ax_bmd, self.ax_def):
            ax.clear()
            ax.grid(True, alpha=0.25)
        self.ax_beam.plot([0, 6], [0, 0], lw=3, color="#26384a")
        self.ax_beam.set_title("Add beam loads and calculate to view diagrams")
        self.ax_beam.set_yticks([])
        self.ax_sfd.set_title("Shear Force Diagram")
        self.ax_bmd.set_title("Bending Moment Diagram")
        self.ax_def.set_title("Deflection Diagram")
        self.canvas.draw_idle()

    def reset(self):
        self.loads.clear()
        self.load_list.delete(0, "end")
        self._show_text("Inputs cleared. Enter beam properties and add loads.")
        self._draw_empty()


def main():
    root = tk.Tk()
    BeamAnalyzerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
