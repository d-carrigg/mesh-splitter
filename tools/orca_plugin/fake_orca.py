"""Stand-in for OrcaSlicer 2.5.1's embedded `orca` module, for tests run outside OrcaSlicer.

Only the names plugin.py uses, with the shapes of the real bindings (src/slic3r/plugin/host/
PluginHostModel.cpp, PluginHostMesh.cpp, PluginHostUi.cpp, pluginTypes/* at tag v2.5.1).
install(objects) puts it in sys.modules["orca"]; objects is a list of FakeObject.
"""
import sys
import tempfile
import types

import numpy as np


class TriangleMesh:
    def __init__(self, V, F):
        self._V = np.ascontiguousarray(V, dtype=np.float32)
        self._F = np.ascontiguousarray(F, dtype=np.int32)
        self._V.flags.writeable = False
        self._F.flags.writeable = False

    def vertices(self):
        return self._V

    def triangles(self):
        return self._F

    def vertex_count(self):
        return len(self._V)

    def triangle_count(self):
        return len(self._F)


class FakeVolume:
    def __init__(self, V, F, matrix=None, name="part", kind="model_part"):
        self._mesh = TriangleMesh(V, F)
        self._m = np.eye(4) if matrix is None else np.asarray(matrix, float)
        self.name = name
        self._kind = kind

    def mesh(self):
        return self._mesh

    def matrix(self):
        return self._m.copy()

    def facets_count(self):
        return self._mesh.triangle_count()

    def is_model_part(self):
        return self._kind == "model_part"


class FakeInstance:
    def __init__(self, matrix=None):
        self._m = np.eye(4) if matrix is None else np.asarray(matrix, float)

    def matrix(self):
        return self._m.copy()


class FakeObject:
    def __init__(self, name, volumes, instance=None):
        self.name = name
        self._vols = volumes
        self._inst = [instance or FakeInstance()]

    def volumes(self):
        return list(self._vols)

    def instance(self, i):
        return self._inst[i]


class FakeModel:
    def __init__(self, objects):
        self._objs = objects

    def objects(self):
        return list(self._objs)


class ExecutionResult:
    def __init__(self, kind, message=""):
        self.kind, self.message = kind, message

    @classmethod
    def success(cls, message="", data=""):
        return cls("success", message)

    @classmethod
    def skipped(cls, message=""):
        return cls("skipped", message)


class _CapBase:
    def __init__(self):
        self.posted = []

    def post_message(self, data):
        self.posted.append(data)


class FakeWindow:
    def __init__(self, **kw):
        self.kw, self.posted, self.open = kw, [], True

    def post(self, obj):
        self.posted.append(obj)

    def is_open(self):
        return self.open


def install(objects, storage=None):
    orca = types.ModuleType("orca")
    state = {"model": FakeModel(objects), "permissions": [], "capabilities": [], "windows": []}
    host = types.SimpleNamespace(
        model=lambda: state["model"],
        plugin=types.SimpleNamespace(storage=lambda: storage or tempfile.gettempdir()),
        ui=types.SimpleNamespace(create_window=lambda **kw: state["windows"].append(FakeWindow(**kw)) or state["windows"][-1]),
    )
    orca.host = host
    orca.pages = types.SimpleNamespace(PagesPluginCapabilityBase=_CapBase)
    orca.script = types.SimpleNamespace(ScriptPluginCapabilityBase=_CapBase)
    orca.ExecutionResult = ExecutionResult
    orca.base = object
    orca.plugin = lambda cls: cls
    orca.request_permissions = lambda **kw: state["permissions"].append(kw)
    orca.register_capability = lambda cls: state["capabilities"].append(cls)
    orca._state = state
    sys.modules["orca"] = orca
    return orca
