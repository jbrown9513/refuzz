// Command gorename gives every name a Go file declares at its top level a suffix, so many fuzz targets written apart
// (each with its own FuzzParse, helper and seeds variable) compile together in one package. `init` and `_` keep their
// names, since a package may have many. Usage: gorename <suffix> <file>; the file is rewritten in place.
//
// It also takes out each `f.Add(<bytes>)` of a fuzz function whose bytes it can read from the source, and prints them as a
// JSON array of base64 strings: those seeds become corpus files, so a seed that fails is a file the fuzzer names, like any
// other failing input. A seed it cannot read stays in the file.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"strconv"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: gorename <suffix> <file>")
		os.Exit(2)
	}
	suffix, path := os.Args[1], os.Args[2]
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	own := map[*ast.Object]bool{}
	for name, obj := range f.Scope.Objects {
		if name != "init" && name != "_" {
			own[obj] = true
		}
	}
	// A composite literal's keys are struct fields, not the file's names, unless the literal is a map's.
	keys := map[*ast.Ident]bool{}
	ast.Inspect(f, func(n ast.Node) bool {
		if c, ok := n.(*ast.CompositeLit); ok {
			if _, isMap := c.Type.(*ast.MapType); !isMap {
				for _, e := range c.Elts {
					if kv, ok := e.(*ast.KeyValueExpr); ok {
						if id, ok := kv.Key.(*ast.Ident); ok {
							keys[id] = true
						}
					}
				}
			}
		}
		return true
	})
	ast.Inspect(f, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok && id.Obj != nil && own[id.Obj] && !keys[id] {
			id.Name += suffix
		}
		return true
	})
	seeds := [][]byte{}
	for _, d := range f.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Body == nil || fn.Type.Params == nil || len(fn.Type.Params.List) != 1 || len(fn.Type.Params.List[0].Names) != 1 {
			continue
		}
		if star, ok := fn.Type.Params.List[0].Type.(*ast.StarExpr); !ok || types(star.X) != "testing.F" {
			continue
		}
		param := fn.Type.Params.List[0].Names[0].Name
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			b, ok := n.(*ast.BlockStmt)
			if !ok {
				return true
			}
			kept := b.List[:0]
			for _, st := range b.List {
				if data, ok := added(st, param); ok {
					seeds = append(seeds, data)
					continue
				}
				kept = append(kept, st)
			}
			b.List = kept
			return true
		})
	}
	var out bytes.Buffer
	if err := format.Node(&out, fset, f); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	json.NewEncoder(os.Stdout).Encode(seeds)
}

func types(e ast.Expr) string {
	if s, ok := e.(*ast.SelectorExpr); ok {
		if x, ok := s.X.(*ast.Ident); ok {
			return x.Name + "." + s.Sel.Name
		}
	}
	return ""
}

// added reads `param.Add(<bytes>)`: the seed's bytes when the source spells them out, as a []byte conversion of string
// literals or a []byte literal of constants.
func added(st ast.Stmt, param string) ([]byte, bool) {
	es, ok := st.(*ast.ExprStmt)
	if !ok {
		return nil, false
	}
	call, ok := es.X.(*ast.CallExpr)
	if !ok || len(call.Args) != 1 {
		return nil, false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != "Add" {
		return nil, false
	}
	if x, ok := sel.X.(*ast.Ident); !ok || x.Name != param {
		return nil, false
	}
	return bytesOf(call.Args[0])
}

func bytesOf(e ast.Expr) ([]byte, bool) {
	switch v := e.(type) {
	case *ast.ParenExpr:
		return bytesOf(v.X)
	case *ast.CallExpr:
		if len(v.Args) == 1 && isByteSlice(v.Fun) {
			if s, ok := str(v.Args[0]); ok {
				return []byte(s), true
			}
			if id, ok := v.Args[0].(*ast.Ident); ok && id.Name == "nil" {
				return []byte{}, true
			}
		}
	case *ast.CompositeLit:
		if !isByteSlice(v.Type) {
			return nil, false
		}
		out := []byte{}
		for _, el := range v.Elts {
			lit, ok := el.(*ast.BasicLit)
			if !ok {
				return nil, false
			}
			switch lit.Kind {
			case token.INT:
				n, err := strconv.ParseUint(lit.Value, 0, 8)
				if err != nil {
					return nil, false
				}
				out = append(out, byte(n))
			case token.CHAR:
				r, _, _, err := strconv.UnquoteChar(lit.Value[1:len(lit.Value)-1], '\'')
				if err != nil || r > 255 {
					return nil, false
				}
				out = append(out, byte(r))
			default:
				return nil, false
			}
		}
		return out, true
	}
	return nil, false
}

// str is a string literal, or a + of them.
func str(e ast.Expr) (string, bool) {
	switch v := e.(type) {
	case *ast.BasicLit:
		if v.Kind == token.STRING {
			s, err := strconv.Unquote(v.Value)
			return s, err == nil
		}
	case *ast.ParenExpr:
		return str(v.X)
	case *ast.BinaryExpr:
		if v.Op == token.ADD {
			a, ok1 := str(v.X)
			b, ok2 := str(v.Y)
			return a + b, ok1 && ok2
		}
	}
	return "", false
}

func isByteSlice(e ast.Expr) bool {
	a, ok := e.(*ast.ArrayType)
	if !ok || a.Len != nil {
		return false
	}
	id, ok := a.Elt.(*ast.Ident)
	return ok && (id.Name == "byte" || id.Name == "uint8")
}
